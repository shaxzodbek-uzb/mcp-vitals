// Compare two `bench --json` runs and decide whether the difference is a regression.
//
// A latency budget (`--fail-on p95<200ms`) catches a server that is slow in absolute
// terms. It cannot catch the far more common case: a change that makes a tool 40% slower
// while still sitting inside a generous budget. That needs the previous run to compare
// against, which is what this does.
//
// Pure and I/O-free, like stats.ts and thresholds.ts, so it is unit-testable without a
// server.

import { UsageError } from './errors.js';
import { METRICS, type Metric } from './thresholds.js';
import type { CompareOp, Stats } from './types.js';

const OPS: CompareOp[] = ['<=', '>=', '!=', '==', '<', '>'];

/** The shape `bench --json` writes, reduced to what a comparison needs. */
export interface BenchRun {
  target?: { kind?: string; name?: string };
  transport?: string;
  coldStartMs?: number | null;
  warm: Stats | null;
  throughput?: { errors?: number; errorRate?: number; rps?: number; completed?: number };
}

export type BoundUnit = 'percent' | 'ms';

export interface RegressionExpr {
  raw: string;
  metric: Metric;
  op: CompareOp;
  bound: number;
  unit: BoundUnit;
}

export interface MetricDelta {
  metric: Metric;
  baseline: number | null;
  current: number | null;
  /** current - baseline, in ms (or as a fraction for errorRate). null if either is missing. */
  delta: number | null;
  /** delta as a percentage of baseline. null when baseline is 0 or missing. */
  deltaPct: number | null;
  /**
   * True when |delta| is within one standard deviation of the baseline run.
   * Not a verdict — a signal that a threshold this tight will flake.
   */
  withinNoise: boolean;
}

export interface RegressionOutcome {
  expr: string;
  metric: Metric;
  op: CompareOp;
  bound: number;
  unit: BoundUnit;
  /** The value actually compared: a percentage or a millisecond delta. */
  actual: number | null;
  pass: boolean;
  withinNoise: boolean;
}

export interface Comparison {
  ok: boolean;
  deltas: MetricDelta[];
  outcomes: RegressionOutcome[];
  coldStart: MetricDelta | null;
  baselineNoisy: boolean;
}

/**
 * Parse a relative gate like `p95>+10%` or `p99>+20ms`.
 *
 * Bounds are **relative to the baseline** — an absolute budget is what
 * `bench --fail-on` already does, and accepting both spellings here would make
 * `p95>200` ambiguous between "200ms slower" and "over 200ms".
 */
export function parseRegressionExpr(expr: string): RegressionExpr {
  const compact = expr.replace(/\s+/g, '');
  for (const op of OPS) {
    const i = compact.indexOf(op);
    if (i <= 0) continue;
    const metric = compact.slice(0, i);
    const rest = compact.slice(i + op.length);
    if (!METRICS.includes(metric as Metric)) {
      throw new UsageError(
        `unknown metric "${metric}" in "${expr}" (allowed: ${METRICS.join(', ')})`,
      );
    }
    const m = /^([+-]?\d+(?:\.\d+)?)(%|ms|s)?$/i.exec(rest);
    if (!m) {
      throw new UsageError(
        `invalid bound "${rest}" in "${expr}" — bounds are relative, e.g. '+10%' or '+20ms'`,
      );
    }
    const value = Number(m[1]);
    const suffix = (m[2] ?? '%').toLowerCase();
    const unit: BoundUnit = suffix === '%' ? 'percent' : 'ms';
    const bound = suffix === 's' ? value * 1000 : value;
    return { raw: expr, metric: metric as Metric, op, bound, unit };
  }
  throw new UsageError(
    `could not parse "${expr}" — expected metric, operator and a relative bound, e.g. 'p95>+10%'`,
  );
}

function metricValue(run: BenchRun, metric: Metric): number | null {
  if (metric === 'errorRate') {
    const rate = run.throughput?.errorRate;
    return typeof rate === 'number' ? rate : null;
  }
  const warm = run.warm;
  if (!warm) return null;
  const value = (warm as unknown as Record<string, unknown>)[metric];
  return typeof value === 'number' ? value : null;
}

function delta(
  baseline: number | null,
  current: number | null,
  noise: number,
): Omit<MetricDelta, 'metric'> & { metric: Metric } {
  const d = baseline === null || current === null ? null : current - baseline;
  const pct = d === null || baseline === null || baseline === 0 ? null : (d / baseline) * 100;
  return {
    metric: 'p50', // replaced by the caller
    baseline,
    current,
    delta: d,
    deltaPct: pct,
    withinNoise: d !== null && noise > 0 && Math.abs(d) <= noise,
  };
}

function compareValue(actual: number, op: CompareOp, bound: number): boolean {
  switch (op) {
    case '<':
      return actual < bound;
    case '<=':
      return actual <= bound;
    case '>':
      return actual > bound;
    case '>=':
      return actual >= bound;
    case '==':
      return actual === bound;
    case '!=':
      return actual !== bound;
  }
}

/**
 * Compare `current` against `baseline`.
 *
 * With no expressions this is a report: `ok` is true and nothing gates. Adding a gate is
 * a deliberate choice, because the right tolerance depends on how noisy your runner is
 * and a default picked here would be arbitrary.
 *
 * A gate whose expression *passes* is still reported as `withinNoise` when the observed
 * difference is inside one standard deviation of the baseline run — the honest caveat on
 * any two-sample latency comparison.
 */
export function compareRuns(
  baseline: BenchRun,
  current: BenchRun,
  exprs: RegressionExpr[] = [],
): Comparison {
  const noise = baseline.warm?.stddev ?? 0;

  const deltas: MetricDelta[] = METRICS.map((metric) => {
    // errorRate is a fraction, not a duration — a stddev in milliseconds says nothing
    // about it, so it is never labelled as noise.
    const scale = metric === 'errorRate' ? 0 : noise;
    return {
      ...delta(metricValue(baseline, metric), metricValue(current, metric), scale),
      metric,
    };
  });

  const byMetric = new Map(deltas.map((d) => [d.metric, d]));

  const outcomes: RegressionOutcome[] = exprs.map((expr) => {
    const d = byMetric.get(expr.metric);
    const actual = d ? (expr.unit === 'percent' ? d.deltaPct : d.delta) : null;
    return {
      expr: expr.raw,
      metric: expr.metric,
      op: expr.op,
      bound: expr.bound,
      unit: expr.unit,
      actual,
      // A metric missing from either run cannot be judged. Failing closed here would
      // turn "the baseline predates this metric" into a red build.
      pass: actual === null ? true : !compareValue(actual, expr.op, expr.bound),
      withinNoise: d?.withinNoise ?? false,
    };
  });

  const coldStartDelta =
    typeof baseline.coldStartMs === 'number' && typeof current.coldStartMs === 'number'
      ? { ...delta(baseline.coldStartMs, current.coldStartMs, noise), metric: 'mean' as Metric }
      : null;

  return {
    ok: outcomes.every((o) => o.pass),
    deltas,
    outcomes,
    coldStart: coldStartDelta,
    // Under ~20 samples a percentile is dominated by which iterations happened to be
    // slow, and comparing two such runs mostly measures the runner.
    baselineNoisy: (baseline.warm?.count ?? 0) < 20,
  };
}

/** Validate that a parsed JSON blob looks like `bench --json` output. */
export function asBenchRun(value: unknown, source: string): BenchRun {
  if (typeof value !== 'object' || value === null) {
    throw new UsageError(`${source} is not a bench JSON object`);
  }
  const run = value as Record<string, unknown>;
  if (!('warm' in run)) {
    throw new UsageError(
      `${source} has no "warm" field — is it output from \`mcp-vitals bench --json\`?`,
    );
  }
  return run as unknown as BenchRun;
}
