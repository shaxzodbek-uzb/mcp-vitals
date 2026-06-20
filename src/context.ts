import type { Command } from 'commander';
import type { RunContext, TransportKind, TransportSpec } from './types.js';
import { UsageError } from './errors.js';
import { resolveColor } from './renderers/colors.js';

const DEFAULT_TIMEOUT_MS = 10_000;

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** Connection-related options shared by every subcommand. */
export function addConnectionOptions(cmd: Command): Command {
  return cmd
    .option('--url <url>', 'connect over HTTP/SSE (mutually exclusive with a stdio command)')
    .option('--transport <kind>', 'force transport: stdio | http | sse')
    .option('--header <k:v>', 'HTTP header for every request (repeatable)', collect, [])
    .option('--env <k=v>', 'env var for the stdio child (repeatable)', collect, [])
    .option('--inherit-env', 'spread process.env into the stdio child before --env vars', false)
    .option('--timeout <ms>', 'per-request timeout in ms (default 10000)', (v) => parseInt(v, 10))
    .option('--connect-timeout <ms>', 'handshake timeout in ms (default = --timeout)', (v) =>
      parseInt(v, 10),
    );
}

/** Output-related options shared by every subcommand. */
export function addOutputOptions(cmd: Command): Command {
  return cmd
    .option('--json', 'emit a single JSON object on stdout; all else to stderr', false)
    .option('--no-color', 'disable ANSI color')
    .option('-q, --quiet', 'suppress non-error progress on stderr', false)
    .option('-v, --verbose', 'verbose per-request timing + relay server stderr', false);
}

export interface CommonOpts {
  url?: string;
  transport?: string;
  header: string[];
  env: string[];
  inheritEnv: boolean;
  timeout?: number;
  connectTimeout?: number;
  json: boolean;
  color: boolean;
  quiet: boolean;
  verbose: boolean;
}

function parseKv(items: string[], sep: string, label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const i = item.indexOf(sep);
    if (i <= 0) throw new UsageError(`invalid ${label} "${item}" (expected K${sep}V)`);
    out[item.slice(0, i).trim()] = item.slice(i + sep.length).trim();
  }
  return out;
}

// Every long option mcp-vitals defines, across all subcommands. Used to catch
// the passThroughOptions footgun where a vitals flag placed AFTER the server
// command is silently handed to the child instead of parsed by mcp-vitals.
const KNOWN_LONG_FLAGS = new Set([
  '--url', '--transport', '--header', '--env', '--inherit-env', '--timeout',
  '--connect-timeout', '--json', '--color', '--no-color', '--quiet', '--verbose',
  '--tools', '--resources', '--prompts', '--schema', '--validate-schemas',
  '--no-validate-schemas', '--filter', '--count', '--list', '--tool', '--probe',
  '--args', '--iterations', '--warmup', '--concurrency', '--rps', '--duration',
  '--fail-on', '--raw', '--expect-error', '--config', '--junit', '--only',
  '--skip', '--bail', '--latency', '--no-latency', '--help', '--version',
]);

/**
 * Reject an mcp-vitals long flag that landed after the server command (and so
 * would be silently passed to the child). Everything after a `--` separator is
 * explicitly the server's and is never flagged.
 */
export function assertNoSwallowedFlags(server: string[]): void {
  for (const token of server) {
    if (token === '--') return; // explicit handoff to the server
    if (token.startsWith('--')) {
      const base = token.split('=')[0] ?? token;
      if (KNOWN_LONG_FLAGS.has(base)) {
        throw new UsageError(
          `"${base}" looks like an mcp-vitals option but came after the server command, ` +
            `so it would be passed to the server instead.\n` +
            `  Put mcp-vitals options BEFORE the command, or after "--" to pass it to the server.`,
        );
      }
    }
  }
}

function parseTransport(value: string | undefined): TransportKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'stdio' || value === 'http' || value === 'sse') return value;
  throw new UsageError(`invalid --transport "${value}" (expected stdio | http | sse)`);
}

export function buildContext(opts: CommonOpts): RunContext {
  return {
    json: opts.json === true,
    color: resolveColor(opts.color === false),
    quiet: opts.quiet === true,
    verbose: opts.verbose === true,
  };
}

/** Drop the first `--` separator; everything else is the server command + argv. */
export function stripSeparator(server: string[]): string[] {
  const i = server.indexOf('--');
  if (i === -1) return server;
  return [...server.slice(0, i), ...server.slice(i + 1)];
}

/** Build the TransportSpec from common options + the positional stdio command. */
export function buildSpec(opts: CommonOpts, server: string[]): TransportSpec {
  assertNoSwallowedFlags(server);
  const cleaned = stripSeparator(server);
  const command = cleaned[0];
  const hasStdio = command !== undefined;
  const hasUrl = opts.url !== undefined && opts.url !== '';

  if (hasStdio && hasUrl) {
    throw new UsageError('pass either a stdio command OR --url, not both');
  }

  const requestTimeoutMs =
    opts.timeout !== undefined && Number.isFinite(opts.timeout) ? opts.timeout : DEFAULT_TIMEOUT_MS;
  const connectTimeoutMs =
    opts.connectTimeout !== undefined && Number.isFinite(opts.connectTimeout)
      ? opts.connectTimeout
      : requestTimeoutMs;

  return {
    forced: parseTransport(opts.transport),
    command,
    args: cleaned.slice(1),
    url: hasUrl ? opts.url : undefined,
    headers: parseKv(opts.header, ':', '--header'),
    env: parseKv(opts.env, '=', '--env'),
    inheritEnv: opts.inheritEnv === true,
    connectTimeoutMs,
    requestTimeoutMs,
  };
}
