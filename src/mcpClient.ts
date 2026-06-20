import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  CapabilitySummary,
  ProbeOp,
  PromptInfo,
  ResourceInfo,
  ServerIdentity,
  ToolInfo,
  TransportKind,
  TransportSpec,
} from './types.js';
import { createTransport, describeTarget, inferKind } from './transport.js';
import { ConnectionError } from './errors.js';

const CLIENT_INFO = { name: 'mcp-vitals', version: '0.1.0' };

export interface CallResult {
  content: unknown[];
  isError: boolean;
  structuredContent?: unknown;
}

function nowMs(): bigint {
  return process.hrtime.bigint();
}
function elapsedMs(start: bigint): number {
  return Number(nowMs() - start) / 1e6;
}

/** A live, connected MCP client plus the metadata mcp-vitals needs. */
export class Connection {
  readonly client: Client;
  readonly kind: TransportKind;
  readonly target: string;
  readonly coldStartMs: number;
  private readonly requestTimeoutMs: number;

  private constructor(
    client: Client,
    kind: TransportKind,
    target: string,
    coldStartMs: number,
    requestTimeoutMs: number,
  ) {
    this.client = client;
    this.kind = kind;
    this.target = target;
    this.coldStartMs = coldStartMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Wrap an already-connected SDK Client (e.g. over InMemoryTransport in tests,
   * or a client you manage yourself). The client must already be `connect()`ed.
   */
  static fromClient(
    client: Client,
    opts: {
      kind?: TransportKind;
      target?: string;
      coldStartMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ): Connection {
    return new Connection(
      client,
      opts.kind ?? 'stdio',
      opts.target ?? 'in-memory',
      opts.coldStartMs ?? 0,
      opts.requestTimeoutMs ?? 10_000,
    );
  }

  /** Connect (timed), with an automatic Streamable-HTTP → SSE fallback. */
  static async connect(spec: TransportSpec): Promise<Connection> {
    const kind = inferKind(spec);
    const target = describeTarget(spec, kind);

    // First attempt with the resolved/forced transport.
    let firstErr: unknown;
    try {
      const r = await connectOnce(spec, kind);
      return new Connection(r.client, kind, target, r.coldStartMs, spec.requestTimeoutMs);
    } catch (err) {
      // Fall back to SSE only when http was inferred (not explicitly forced).
      const canFallback = kind === 'http' && spec.forced === undefined && Boolean(spec.url);
      if (!canFallback) {
        throw new ConnectionError(connectMessage(target, spec, err));
      }
      firstErr = err;
    }

    try {
      const r = await connectOnce(spec, 'sse');
      return new Connection(r.client, 'sse', target, r.coldStartMs, spec.requestTimeoutMs);
    } catch (err) {
      const base = connectMessage(target, spec, err);
      // Preserve the original Streamable-HTTP error (e.g. the server's auth body)
      // instead of misattributing the failure to the SSE attempt.
      const httpNote = firstErr
        ? `\n  (Streamable HTTP attempt failed first: ${(firstErr as Error).message})`
        : '';
      throw new ConnectionError(base + httpNote);
    }
  }

  identity(): ServerIdentity {
    const v = this.client.getServerVersion();
    // The negotiated protocol version has no stable client getter in SDK 1.29.
    // Streamable HTTP exposes a public `protocolVersion`; SSE keeps it in a
    // private field. stdio tracks it nowhere, so it stays undefined there.
    const t = (this.client as unknown as { transport?: { protocolVersion?: unknown; _protocolVersion?: unknown } })
      .transport;
    const proto =
      (typeof t?.protocolVersion === 'string' ? t.protocolVersion : undefined) ??
      (typeof t?._protocolVersion === 'string' ? t._protocolVersion : undefined);
    return {
      name: v?.name ?? '(unknown)',
      version: v?.version ?? '0.0.0',
      protocolVersion: proto,
      instructions: this.client.getInstructions(),
    };
  }

  capabilities(): CapabilitySummary {
    const caps = (this.client.getServerCapabilities() ?? {}) as Record<string, unknown>;
    return {
      tools: caps.tools !== undefined,
      resources: caps.resources !== undefined,
      prompts: caps.prompts !== undefined,
      logging: caps.logging !== undefined,
      completions: caps.completions !== undefined,
      raw: caps,
    };
  }

  async listTools(): Promise<ToolInfo[]> {
    if (!this.capabilities().tools) return [];
    const out: ToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: this.requestTimeoutMs },
      );
      for (const t of res.tools) {
        const input = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
        const props = input?.properties ?? {};
        out.push({
          name: t.name,
          title: t.title ?? t.annotations?.title,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
          requiredArgs: input?.required?.length ?? 0,
          totalArgs: Object.keys(props).length,
          schemaValid: true,
          schemaErrors: [],
        });
      }
      cursor = res.nextCursor as string | undefined;
    } while (cursor);
    return out;
  }

  async listResources(): Promise<ResourceInfo[]> {
    if (!this.capabilities().resources) return [];
    const out: ResourceInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.listResources(
        cursor ? { cursor } : undefined,
        { timeout: this.requestTimeoutMs },
      );
      for (const r of res.resources) {
        out.push({ uri: r.uri, name: r.name, mimeType: r.mimeType });
      }
      cursor = res.nextCursor as string | undefined;
    } while (cursor);
    return out;
  }

  async listPrompts(): Promise<PromptInfo[]> {
    if (!this.capabilities().prompts) return [];
    const out: PromptInfo[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.listPrompts(
        cursor ? { cursor } : undefined,
        { timeout: this.requestTimeoutMs },
      );
      for (const p of res.prompts) {
        out.push({
          name: p.name,
          description: p.description,
          arguments: (p.arguments ?? []).map((a) => ({ name: a.name, required: a.required })),
        });
      }
      cursor = res.nextCursor as string | undefined;
    } while (cursor);
    return out;
  }

  async callTool(name: string, args: unknown, timeoutMs?: number): Promise<CallResult> {
    const res = await this.client.callTool(
      { name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: timeoutMs ?? this.requestTimeoutMs },
    );
    return {
      content: (res.content ?? []) as unknown[],
      isError: res.isError === true,
      structuredContent: res.structuredContent,
    };
  }

  async ping(timeoutMs?: number): Promise<void> {
    await this.client.ping({ timeout: timeoutMs ?? this.requestTimeoutMs });
  }

  /** A single no-arg protocol round-trip (always hits the server, no early return). */
  async probeOnce(op: ProbeOp, timeoutMs?: number): Promise<void> {
    const options = { timeout: timeoutMs ?? this.requestTimeoutMs };
    if (op === 'listTools') await this.client.listTools(undefined, options);
    else if (op === 'listResources') await this.client.listResources(undefined, options);
    else await this.client.listPrompts(undefined, options);
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // closing best-effort; never mask the real result.
    }
  }
}

/** Build a transport and connect a fresh Client over it (timed cold start). */
async function connectOnce(
  spec: TransportSpec,
  kind: TransportKind,
): Promise<{ client: Client; coldStartMs: number }> {
  const start = nowMs();
  const client = new Client(CLIENT_INFO);
  await client.connect(createTransport(spec, kind), { timeout: spec.connectTimeoutMs });
  return { client, coldStartMs: elapsedMs(start) };
}

function connectMessage(target: string, spec: TransportSpec, err: unknown): string {
  const base = `could not connect to ${target}: ${(err as Error).message}`;
  if (spec.command) {
    return `${base}\n  hint: the server may need env vars — try --env KEY=VALUE or --inherit-env`;
  }
  return base;
}
