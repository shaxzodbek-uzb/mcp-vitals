import type { Connection } from '../mcpClient.js';
import type {
  AssertionsConfig,
  CheckRow,
  CheckStatus,
  CheckSummary,
  LatencyAssertion,
  BenchConfig,
} from '../types.js';
import { runBench } from '../bench/engine.js';
import { evaluate } from '../thresholds.js';
import { parseBound } from '../thresholds.js';
import { validateJsonSchema } from '../schema.js';
import { matchesGlob } from '../glob.js';
import { formatMs, formatPct } from '../renderers/table.js';

export interface RunOptions {
  noLatency: boolean;
  only: string[];
  skip: string[];
  bail: boolean;
  iterations?: number;
  warmup?: number;
  concurrency?: number;
  timeoutMs: number;
}

const LATENCY_METRICS = ['p50', 'p90', 'p95', 'p99', 'max', 'mean', 'errorRate'] as const;
type LatencyMetric = (typeof LATENCY_METRICS)[number];

function included(id: string, only: string[], skip: string[]): boolean {
  const passOnly = only.length === 0 || only.some((g) => matchesGlob(id, g));
  const blocked = skip.length > 0 && skip.some((g) => matchesGlob(id, g));
  return passOnly && !blocked;
}

function displayBound(metric: string, bound: number): string {
  return metric === 'errorRate' ? formatPct(bound) : formatMs(bound);
}

function displayActual(metric: string, actual: number | null): string {
  if (actual === null) return '—';
  return metric === 'errorRate' ? formatPct(actual) : formatMs(actual);
}

export async function runChecks(
  conn: Connection,
  config: AssertionsConfig,
  options: RunOptions,
): Promise<{ rows: CheckRow[]; summary: CheckSummary }> {
  const start = process.hrtime.bigint();
  const rows: CheckRow[] = [];
  let bailed = false;

  const add = (row: CheckRow): void => {
    rows.push(row);
    if (options.bail && row.status === 'fail') bailed = true;
  };

  const tools = await conn.listTools();
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const resources = await conn.listResources();
  const prompts = await conn.listPrompts();
  const resourceNames = new Set(resources.map((r) => r.name).filter((n): n is string => !!n));
  const promptNames = new Set(prompts.map((p) => p.name));

  const expect = config.expect ?? {};

  // ---- presence suite ----
  const presence: [string, string[], (n: string) => boolean][] = [
    ['tools', expect.tools ?? [], (n) => toolByName.has(n)],
    ['resources', expect.resources ?? [], (n) => resourceNames.has(n)],
    ['prompts', expect.prompts ?? [], (n) => promptNames.has(n)],
  ];
  for (const [kind, names, has] of presence) {
    for (const name of names) {
      if (bailed) break;
      const id = `${kind}/${name}`;
      if (!included(id, options.only, options.skip)) {
        add({ id, kind: 'presence', target: name, expected: 'present', actual: 'skipped', status: 'skip' });
        continue;
      }
      const ok = has(name);
      add({
        id,
        kind: 'presence',
        target: name,
        expected: `${kind} present`,
        actual: ok ? 'present' : 'MISSING',
        status: ok ? 'pass' : 'fail',
      });
    }
  }

  // ---- schema suite ----
  if (expect.schemasValid && !bailed) {
    const targets = (expect.tools && expect.tools.length > 0 ? expect.tools : tools.map((t) => t.name));
    for (const name of targets) {
      if (bailed) break;
      const id = `schema/${name}`;
      if (!included(id, options.only, options.skip)) {
        add({ id, kind: 'schema', target: name, expected: 'valid', actual: 'skipped', status: 'skip' });
        continue;
      }
      const tool = toolByName.get(name);
      if (!tool) {
        add({ id, kind: 'schema', target: name, expected: 'valid inputSchema', actual: 'tool missing', status: 'fail' });
        continue;
      }
      const res = validateJsonSchema(tool.inputSchema);
      add({
        id,
        kind: 'schema',
        target: name,
        expected: 'valid inputSchema',
        actual: res.valid ? 'valid' : (res.errors[0]?.message ?? 'invalid'),
        status: res.valid ? 'pass' : 'fail',
      });
    }
  }

  // ---- latency suite ----
  for (const assertion of config.latency ?? []) {
    if (bailed) break;
    const thresholds = LATENCY_METRICS.filter((m) => assertion[m] !== undefined);
    if (thresholds.length === 0) continue;

    const targetName = assertion.tool ?? assertion.probe ?? 'listTools';
    const targetKind = assertion.tool ? 'tool' : 'probe';

    if (options.noLatency) {
      for (const metric of thresholds) {
        const id = `${assertion.id}/${metric}`;
        add({ id, kind: 'latency', target: targetName, expected: 'latency SLA', actual: 'skipped', status: 'skip' });
      }
      continue;
    }

    // Determine which thresholds are actually selected before running the bench.
    const selected = thresholds.filter((m) => included(`${assertion.id}/${m}`, options.only, options.skip));
    if (selected.length === 0) {
      for (const metric of thresholds) {
        const id = `${assertion.id}/${metric}`;
        add({ id, kind: 'latency', target: targetName, expected: 'latency SLA', actual: 'skipped', status: 'skip' });
      }
      continue;
    }

    const benchConfig: BenchConfig = {
      targetKind,
      targetName,
      args: assertion.args ?? {},
      iterations:
        options.iterations ?? assertion.iterations ?? config.defaults?.iterations ?? 50,
      warmup: options.warmup ?? assertion.warmup ?? config.defaults?.warmup ?? 1,
      concurrency: options.concurrency ?? assertion.concurrency ?? config.defaults?.concurrency ?? 1,
      keepAlive: true,
    };
    const result = await runBench(conn, benchConfig, options.timeoutMs);

    for (const metric of thresholds) {
      const id = `${assertion.id}/${metric}`;
      if (!selected.includes(metric)) {
        add({ id, kind: 'latency', target: targetName, expected: 'latency SLA', actual: 'skipped', status: 'skip' });
        continue;
      }
      const bound = parseBound(metric, assertion[metric] as string | number);
      const outcome = evaluate({ metric, op: '<=', bound }, result.warm, result.throughput);
      const status: CheckStatus = outcome.pass ? 'pass' : 'fail';
      add({
        id,
        kind: 'latency',
        target: `${targetName} ${metric}`,
        expected: `${metric} <= ${displayBound(metric, bound)}`,
        actual: displayActual(metric, outcome.actual),
        status,
      });
      if (bailed) break;
    }
  }

  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  const summary: CheckSummary = {
    passed: rows.filter((r) => r.status === 'pass').length,
    failed: rows.filter((r) => r.status === 'fail').length,
    skipped: rows.filter((r) => r.status === 'skip').length,
    durationMs,
  };
  return { rows, summary };
}

export type { LatencyAssertion, LatencyMetric };
