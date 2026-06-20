import { createRequire } from 'node:module';
import { Command, CommanderError } from 'commander';
import { addConnectionOptions, addOutputOptions } from './context.js';
import { CliError, EXIT_CODES, toExitCode, UsageError } from './errors.js';
import { writeErr } from './output.js';
import { runInspect } from './commands/inspect.js';
import { runPing } from './commands/ping.js';
import { runBenchCommand } from './commands/bench.js';
import { runCall } from './commands/call.js';
import { runCheck } from './commands/check.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// Validating numeric parsers: a bad value throws a UsageError (exit 4) instead
// of yielding NaN, which would otherwise produce a silent zero-sample run.
const posInt = (label: string, min = 1) => (v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) {
    throw new UsageError(`--${label} must be an integer >= ${min} (got "${v}")`);
  }
  return n;
};
const posFloat = (label: string) => (v: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new UsageError(`--${label} must be a number > 0 (got "${v}")`);
  }
  return n;
};
const collect = (v: string, prev: string[]): string[] => prev.concat([v]);

type Action = (server: string[], opts: Record<string, unknown>) => Promise<number>;

/** Wrap a command body so its numeric exit code propagates via process.exitCode. */
function action(fn: Action) {
  return async (server: string[], opts: Record<string, unknown>): Promise<void> => {
    const code = await fn(server, opts);
    if (code) process.exitCode = code;
  };
}

function withCommon(cmd: Command): Command {
  return addOutputOptions(addConnectionOptions(cmd));
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('mcp-vitals')
    .description('Vital signs for your MCP server: inspect, benchmark latency, and assert health in CI.')
    .version(pkg.version, '-V, --version')
    .enablePositionalOptions()
    .showHelpAfterError();

  withCommon(
    program
      .command('inspect')
      .description('discover capabilities, list tools/resources/prompts, validate schemas')
      .argument('[server...]', 'stdio server launch command + argv'),
  )
    .passThroughOptions()
    .option('--tools', 'show only tools')
    .option('--resources', 'show only resources')
    .option('--prompts', 'show only prompts')
    .option('--schema', 'include full inputSchema in --json output')
    .option('--no-validate-schemas', 'skip JSON Schema validation of tool inputSchemas')
    .option('--filter <glob>', 'filter listed names by glob (* and ?)')
    .action(action((server, opts) => runInspect(server, opts as never)));

  withCommon(
    program
      .command('ping')
      .description('measure handshake/initialize latency and liveness')
      .argument('[server...]', 'stdio server launch command + argv'),
  )
    .passThroughOptions()
    .option('-n, --count <n>', 'number of independent reconnect cycles', posInt('count'), 1)
    .option('--list', 'also time one tools/list round-trip')
    .action(action((server, opts) => runPing(server, opts as never)));

  withCommon(
    program
      .command('bench')
      .description('benchmark tool-call latency: p50/p95/p99, throughput, cold start')
      .argument('[server...]', 'stdio server launch command + argv'),
  )
    .passThroughOptions()
    .option('--tool <name>', 'tool to benchmark')
    .option('--probe <op>', 'no-arg protocol op: listTools | listResources | listPrompts')
    .option('--args <json>', "tool args JSON ('-' = stdin, '@file.json' = file)")
    .option('-n, --iterations <n>', 'measured iterations (default 50)', posInt('iterations'))
    .option('-w, --warmup <n>', 'warmup iterations, reported as cold start', posInt('warmup', 0), 1)
    .option('-c, --concurrency <n>', 'keep N operations in flight (closed model)', posInt('concurrency'), 1)
    .option('--rps <r>', 'drive R requests/sec arrival rate (open model)', posFloat('rps'))
    .option('-d, --duration <ms>', 'run for a wall-clock duration instead of -n', posInt('duration'))
    .option('--fail-on <expr>', "SLA gate, e.g. 'p95<200ms' (repeatable)", collect, [])
    .action(action((server, opts) => runBenchCommand(server, opts as never)));

  withCommon(
    program
      .command('call')
      .description('invoke one tool once and print the result + timing')
      .argument('[server...]', 'stdio server launch command + argv'),
  )
    .passThroughOptions()
    .option('--tool <name>', 'tool to call (required)')
    .option('--args <json>', "tool args JSON ('-' = stdin, '@file.json' = file)")
    .option('--raw', 'print only the tool result content (for piping)')
    .option('--expect-error', 'exit 0 only if the call returns an MCP tool error')
    .action(action((server, opts) => runCall(server, opts as never)));

  withCommon(
    program
      .command('check')
      .description('run a committed mcp-vitals.yaml assertion suite (the CI gate)')
      .argument('[server...]', 'optional stdio command override for the config server'),
  )
    .passThroughOptions()
    .option('-c, --config <path>', 'assertions file (default: auto-discover mcp-vitals.{yaml,yml,json})')
    .option('--junit <path>', "write JUnit XML to a path ('-' for stdout)")
    .option('--only <glob>', 'run only assertions whose id matches (repeatable)', collect, [])
    .option('--skip <glob>', 'skip assertions whose id matches (repeatable)', collect, [])
    .option('--iterations <n>', 'override bench iterations for all latency assertions', posInt('iterations'))
    .option('--warmup <n>', 'override bench warmup for all latency assertions', posInt('warmup', 0))
    .option('--concurrency <n>', 'override bench concurrency for all latency assertions', posInt('concurrency'))
    .option('--bail', 'stop at the first failed assertion', false)
    .option('--no-latency', 'skip timed latency benches (presence + schema only)')
    .action(action((server, opts) => runCheck(server, opts as never)));

  return program;
}

function reportError(err: unknown): number {
  if (err instanceof CliError) {
    writeErr(`mcp-vitals: ${err.message}`);
    return err.exitCode;
  }
  writeErr(`mcp-vitals: ${(err as Error)?.message ?? String(err)}`);
  return toExitCode(err) === 0 ? 1 : toExitCode(err);
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  // exitOverride is per-command — apply to the program AND every subcommand so
  // parse/usage errors throw a CommanderError instead of calling process.exit().
  program.exitOverride();
  for (const sub of program.commands) sub.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version display exits 0; parse/usage errors map to our usage code.
      return err.exitCode === 0 ? 0 : EXIT_CODES.USAGE;
    }
    return reportError(err);
  }
  return process.exitCode ? Number(process.exitCode) : 0;
}
