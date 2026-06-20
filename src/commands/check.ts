import { writeFile } from 'node:fs/promises';
import type { CommonOpts } from '../context.js';
import { assertNoSwallowedFlags, buildContext, stripSeparator } from '../context.js';
import { Connection } from '../mcpClient.js';
import { loadConfig } from '../assertions/loader.js';
import { runChecks } from '../assertions/run.js';
import { AssertionFailure, UsageError } from '../errors.js';
import { makeColors } from '../renderers/colors.js';
import type { Colors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { renderJUnit } from '../renderers/junit.js';
import { renderTable } from '../renderers/table.js';
import { writeOut } from '../output.js';
import { Progress } from '../renderers/progress.js';
import type { AssertionsConfig, CheckRow, SuiteKind, TransportKind, TransportSpec } from '../types.js';

export interface CheckOpts extends CommonOpts {
  config?: string;
  junit?: string;
  only: string[];
  skip: string[];
  iterations?: number;
  warmup?: number;
  concurrency?: number;
  bail: boolean;
  latency: boolean; // commander --no-latency => false
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

/** Combine the config's server block with any CLI overrides + positional command. */
function buildCheckSpec(config: AssertionsConfig, opts: CheckOpts, server: string[]): TransportSpec {
  const s = config.server;
  const cleaned = stripSeparator(server);
  const positional = cleaned[0];
  const cliUrl = opts.url !== undefined && opts.url !== '' ? opts.url : undefined;

  let command: string | undefined;
  let args: string[] = [];
  let url: string | undefined;
  if (positional) {
    command = positional;
    args = cleaned.slice(1);
  } else if (cliUrl) {
    url = cliUrl;
  } else if (s.url) {
    url = s.url;
  } else {
    command = s.command;
    args = s.args ?? [];
  }

  const requestTimeoutMs = opts.timeout ?? s.timeoutMs ?? 10_000;
  const connectTimeoutMs = opts.connectTimeout ?? s.connectTimeoutMs ?? requestTimeoutMs;
  const forced = (opts.transport as TransportKind | undefined) ?? s.transport;

  return {
    forced,
    command,
    args,
    url,
    headers: { ...(s.headers ?? {}), ...parseKv(opts.header, ':', '--header') },
    env: { ...(s.env ?? {}), ...parseKv(opts.env, '=', '--env') },
    inheritEnv: opts.inheritEnv === true,
    connectTimeoutMs,
    requestTimeoutMs,
  };
}

const GROUPS: [SuiteKind, string][] = [
  ['presence', 'Capabilities'],
  ['schema', 'Schemas'],
  ['latency', 'Latency SLAs'],
];

function statusCell(status: CheckRow['status'], c: Colors): string {
  if (status === 'pass') return c.green('PASS');
  if (status === 'fail') return c.red('FAIL');
  return c.dim('SKIP');
}

export async function runCheck(server: string[], opts: CheckOpts): Promise<number> {
  const ctx = buildContext(opts);
  const c = makeColors(ctx.color);
  const progress = new Progress({ quiet: ctx.quiet, json: ctx.json });

  if (ctx.json && opts.junit === '-') {
    throw new UsageError('--junit - conflicts with --json (both write stdout); give --junit a file path');
  }
  assertNoSwallowedFlags(server);

  const { path, config } = await loadConfig(opts.config);
  progress.note(c.dim(`loaded ${path}`));
  const spec = buildCheckSpec(config, opts, server);

  progress.note(c.dim('connecting…'));
  const conn = await Connection.connect(spec);

  const { rows, summary } = await runChecks(conn, config, {
    noLatency: opts.latency === false,
    only: opts.only,
    skip: opts.skip,
    bail: opts.bail === true,
    iterations: opts.iterations,
    warmup: opts.warmup,
    concurrency: opts.concurrency,
    timeoutMs: spec.requestTimeoutMs,
  });
  await conn.close();

  if (opts.junit) {
    const xml = renderJUnit(rows, summary);
    if (opts.junit === '-') process.stdout.write(xml + '\n');
    else await writeFile(opts.junit, xml, 'utf8');
  }

  if (ctx.json) {
    emitJson({
      ok: summary.failed === 0,
      config: path,
      suites: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        target: r.target,
        expected: r.expected,
        actual: r.actual,
        status: r.status,
      })),
      summary,
    });
  } else {
    for (const [kind, label] of GROUPS) {
      const groupRows = rows.filter((r) => r.kind === kind);
      if (groupRows.length === 0) continue;
      writeOut('');
      writeOut(c.bold(label));
      writeOut(
        renderTable(
          [{ header: 'CHECK' }, { header: 'EXPECTED' }, { header: 'ACTUAL' }, { header: 'STATUS' }],
          groupRows.map((r) => [r.id, r.expected, r.actual, statusCell(r.status, c)]),
          c,
        ),
      );
    }
    writeOut('');
    const parts = [
      c.green(`${summary.passed} passed`),
      summary.failed ? c.red(`${summary.failed} failed`) : `${summary.failed} failed`,
      c.dim(`${summary.skipped} skipped`),
    ];
    writeOut(`${parts.join(', ')} ${c.dim(`in ${(summary.durationMs / 1000).toFixed(2)}s`)}`);
  }

  if (summary.failed > 0) {
    throw new AssertionFailure(`${summary.failed} check(s) failed`);
  }
  return 0;
}
