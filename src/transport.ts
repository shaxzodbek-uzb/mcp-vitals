import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { TransportKind, TransportSpec } from './types.js';
import { UsageError } from './errors.js';

/** Infer the transport kind from the spec when not explicitly forced. */
export function inferKind(spec: TransportSpec): TransportKind {
  if (spec.forced) return spec.forced;
  if (spec.url) return 'http';
  if (spec.command) return 'stdio';
  throw new UsageError('no server specified: pass a stdio command or --url <url>');
}

function processEnvAsStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function stdioEnv(spec: TransportSpec): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    ...(spec.inheritEnv ? processEnvAsStrings() : {}),
    ...spec.env,
  };
}

function toUrl(spec: TransportSpec): URL {
  if (!spec.url) throw new UsageError('a URL is required for http/sse transports (use --url)');
  try {
    return new URL(spec.url);
  } catch {
    throw new UsageError(`invalid --url: "${spec.url}"`);
  }
}

/** Build a fresh Transport instance for the requested kind. */
export function createTransport(spec: TransportSpec, kind: TransportKind): Transport {
  switch (kind) {
    case 'stdio': {
      if (!spec.command) throw new UsageError('no stdio command specified');
      return new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: stdioEnv(spec),
        stderr: 'pipe',
      });
    }
    case 'http':
      return new StreamableHTTPClientTransport(toUrl(spec), {
        requestInit: { headers: spec.headers },
      });
    case 'sse':
      return new SSEClientTransport(toUrl(spec), {
        requestInit: { headers: spec.headers },
      });
  }
}

/** Human label for the resolved target, for headers and JSON output. */
export function describeTarget(spec: TransportSpec, kind: TransportKind): string {
  if (kind === 'stdio') return [spec.command, ...spec.args].filter(Boolean).join(' ');
  return spec.url ?? '(unknown)';
}
