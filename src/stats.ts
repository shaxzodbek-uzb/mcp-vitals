import type { Stats } from './types.js';

/**
 * Nearest-rank percentile on an already-sorted ascending array.
 * pct(q) = arr[min(len-1, ceil(q/100*len)-1)].
 */
export function percentile(sortedAsc: number[], q: number): number {
  const len = sortedAsc.length;
  if (len === 0) return NaN;
  const rank = Math.ceil((q / 100) * len) - 1;
  const idx = Math.min(len - 1, Math.max(0, rank));
  return sortedAsc[idx] as number;
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stddev(values: number[], mu?: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const m = mu ?? mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  // Population standard deviation (we have the full sample set).
  return Math.sqrt(acc / n);
}

/** Compute the full latency distribution from raw (unsorted) samples. */
export function computeStats(samples: number[]): Stats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const m = mean(sorted);
  return {
    count: sorted.length,
    min: sorted[0] as number,
    mean: m,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] as number,
    stddev: stddev(sorted, m),
    unit: 'ms',
  };
}

/** Round to 2 decimals for display without lying about precision. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
