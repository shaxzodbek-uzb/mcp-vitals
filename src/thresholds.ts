import type { AssertionOutcome, CompareOp, Stats, Throughput } from './types.js';
import { UsageError } from './errors.js';

export const METRICS = [
  'p50',
  'p90',
  'p95',
  'p99',
  'max',
  'min',
  'mean',
  'stddev',
  'errorRate',
] as const;
export type Metric = (typeof METRICS)[number];

const OPS: CompareOp[] = ['<=', '>=', '!=', '==', '<', '>'];

/**
 * Parse a duration to milliseconds.
 * Bare number => ms. Suffix `ms` => ms. Suffix `s` => seconds.
 */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') return input;
  const s = input.trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*(ms|s)?$/i.exec(s);
  if (!m) throw new UsageError(`invalid duration: "${input}"`);
  const value = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  return unit === 's' ? value * 1000 : value;
}

/** errorRate is a fraction 0..1; everything else is a duration. */
export function parseBound(metric: string, raw: string | number): number {
  if (metric === 'errorRate') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) throw new UsageError(`invalid errorRate bound: "${raw}"`);
    return n;
  }
  return parseDuration(raw);
}

export interface ParsedExpr {
  metric: string;
  op: CompareOp;
  bound: number;
}

/** Parse an inline `--fail-on` expression like `p95<200ms` or `errorRate<=0`. */
export function parseExpr(expr: string): ParsedExpr {
  const compact = expr.replace(/\s+/g, '');
  for (const op of OPS) {
    const i = compact.indexOf(op);
    if (i > 0) {
      const metric = compact.slice(0, i);
      const rest = compact.slice(i + op.length);
      if (!METRICS.includes(metric as Metric)) {
        throw new UsageError(
          `unknown metric "${metric}" in "${expr}" (allowed: ${METRICS.join(', ')})`,
        );
      }
      if (rest === '') throw new UsageError(`missing bound in "${expr}"`);
      return { metric, op, bound: parseBound(metric, rest) };
    }
  }
  throw new UsageError(`invalid assertion "${expr}" (expected e.g. p95<200ms)`);
}

function metricValue(metric: string, stats: Stats | null, throughput: Throughput): number | null {
  if (metric === 'errorRate') return throughput.errorRate;
  if (!stats) return null;
  switch (metric) {
    case 'p50':
      return stats.p50;
    case 'p90':
      return stats.p90;
    case 'p95':
      return stats.p95;
    case 'p99':
      return stats.p99;
    case 'max':
      return stats.max;
    case 'min':
      return stats.min;
    case 'mean':
      return stats.mean;
    case 'stddev':
      return stats.stddev;
    default:
      return null;
  }
}

function compare(actual: number, op: CompareOp, bound: number): boolean {
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

/** Evaluate one parsed expression against a stats + throughput pair. */
export function evaluate(
  parsed: ParsedExpr,
  stats: Stats | null,
  throughput: Throughput,
): AssertionOutcome {
  const actual = metricValue(parsed.metric, stats, throughput);
  const exprStr = `${parsed.metric}${parsed.op}${parsed.bound}`;
  const pass = actual === null ? false : compare(actual, parsed.op, parsed.bound);
  return { expr: exprStr, metric: parsed.metric, op: parsed.op, bound: parsed.bound, actual, pass };
}

/** Convenience for inline string expressions. */
export function evaluateExpr(
  expr: string,
  stats: Stats | null,
  throughput: Throughput,
): AssertionOutcome {
  return evaluate(parseExpr(expr), stats, throughput);
}
