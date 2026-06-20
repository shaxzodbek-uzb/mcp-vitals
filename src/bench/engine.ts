import type { Connection } from '../mcpClient.js';
import type { BenchConfig, BenchResult, BenchSample, ProbeOp, Throughput } from '../types.js';
import { computeStats } from '../stats.js';
import { UsageError } from '../errors.js';

/** One operation under test. Resolves with whether the result was a tool-level error. */
type BenchOp = () => Promise<{ toolError: boolean }>;

interface Outcome {
  ms: number;
  threw: boolean;
  toolError: boolean;
}

export interface BenchHooks {
  /** Called after each measured iteration with the running completed count. */
  onTick?: (completed: number) => void;
}

function buildOp(conn: Connection, config: BenchConfig, timeoutMs: number): BenchOp {
  if (config.targetKind === 'tool') {
    const name = config.targetName;
    return async () => {
      const r = await conn.callTool(name, config.args, timeoutMs);
      return { toolError: r.isError };
    };
  }
  const probe = config.targetName as ProbeOp;
  return async () => {
    await conn.probeOnce(probe, timeoutMs);
    return { toolError: false };
  };
}

async function runOnce(op: BenchOp): Promise<Outcome> {
  const start = process.hrtime.bigint();
  try {
    const r = await op();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ms, threw: false, toolError: r.toolError };
  } catch {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    return { ms, threw: true, toolError: false };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Closed model: keep `concurrency` operations in flight until the budget is exhausted. */
async function runClosed(
  op: BenchOp,
  concurrency: number,
  shouldContinue: () => boolean,
  onOutcome: (o: Outcome) => void,
): Promise<void> {
  const worker = async (): Promise<void> => {
    while (shouldContinue()) {
      onOutcome(await runOnce(op));
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
}

/** Open model: dispatch at a target arrival rate regardless of in-flight count. */
async function runOpen(
  op: BenchOp,
  rps: number,
  shouldDispatch: () => boolean,
  onOutcome: (o: Outcome) => void,
): Promise<void> {
  const interval = 1000 / rps;
  const inflight: Promise<void>[] = [];
  // Pace against an absolute clock so dispatches don't drift slow from
  // cumulative setTimeout overshoot, and so there's no wasted trailing delay.
  const t0 = performance.now();
  let i = 0;
  while (shouldDispatch()) {
    if (i > 0) await delay(Math.max(0, t0 + i * interval - performance.now()));
    inflight.push(runOnce(op).then(onOutcome));
    i++;
  }
  await Promise.all(inflight);
}

export async function runBench(
  conn: Connection,
  config: BenchConfig,
  timeoutMs: number,
  hooks: BenchHooks = {},
): Promise<BenchResult> {
  if (config.iterations !== undefined && config.durationMs !== undefined) {
    throw new UsageError('cannot combine --iterations and --duration');
  }
  const op = buildOp(conn, config, timeoutMs);

  // --- warmup (sequential, excluded from warm stats) ---
  let coldStartMs: number | null = null;
  for (let i = 0; i < config.warmup; i++) {
    const o = await runOnce(op);
    if (i === 0) coldStartMs = o.ms;
  }

  // --- measured phase ---
  const raw: BenchSample[] = [];
  const latencySamples: number[] = [];
  let toolErrors = 0;
  let threws = 0;

  const onOutcome = (o: Outcome): void => {
    raw.push({ ms: o.ms, error: o.threw || o.toolError });
    if (!o.threw) latencySamples.push(o.ms); // throws have no meaningful latency
    if (o.toolError) toolErrors++;
    if (o.threw) threws++;
    hooks.onTick?.(raw.length);
  };

  const byCount = config.iterations !== undefined;
  const targetCount = config.iterations ?? 0;
  const deadline = config.durationMs !== undefined ? performance.now() + config.durationMs : 0;

  // For closed-count mode we must not over-dispatch past targetCount.
  let dispatched = 0;
  const wall0 = process.hrtime.bigint();

  if (config.rps !== undefined) {
    const shouldDispatch = byCount
      ? () => dispatched++ < targetCount
      : () => performance.now() < deadline;
    await runOpen(op, config.rps, shouldDispatch, onOutcome);
  } else {
    const shouldContinue = byCount
      ? () => dispatched++ < targetCount
      : () => performance.now() < deadline;
    await runClosed(op, Math.max(1, config.concurrency), shouldContinue, onOutcome);
  }

  const wallMs = Number(process.hrtime.bigint() - wall0) / 1e6;
  const completed = raw.length;
  const errors = toolErrors + threws;
  const throughput: Throughput = {
    rps: wallMs > 0 ? (completed / wallMs) * 1000 : 0,
    completed,
    errors,
    errorRate: completed > 0 ? errors / completed : 0,
  };

  return {
    coldStartMs,
    warm: computeStats(latencySamples),
    throughput,
    samples: latencySamples,
    raw,
  };
}
