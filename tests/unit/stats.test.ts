import { describe, expect, it } from 'vitest';
import { computeStats, percentile } from '../../src/stats.js';

describe('percentile (nearest-rank)', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('computes p50/p90/p95/p100 by nearest-rank', () => {
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 90)).toBe(9);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 100)).toBe(10);
  });

  it('returns the only value for a single sample', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('returns NaN for an empty array', () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});

describe('computeStats', () => {
  it('returns null for no samples', () => {
    expect(computeStats([])).toBeNull();
  });

  it('sorts input before computing and fills every field', () => {
    const s = computeStats([10, 1, 5, 3, 2])!;
    expect(s.count).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(10);
    expect(s.p50).toBe(3);
    expect(s.mean).toBeCloseTo(4.2, 5);
    expect(s.unit).toBe('ms');
    expect(s.stddev).toBeGreaterThan(0);
  });

  it('reports zero stddev for identical samples', () => {
    const s = computeStats([7, 7, 7, 7])!;
    expect(s.mean).toBe(7);
    expect(s.stddev).toBe(0);
    expect(s.p99).toBe(7);
  });
});
