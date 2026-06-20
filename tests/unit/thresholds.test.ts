import { describe, expect, it } from 'vitest';
import { evaluate, evaluateExpr, parseDuration, parseExpr } from '../../src/thresholds.js';
import { UsageError } from '../../src/errors.js';
import type { Stats, Throughput } from '../../src/types.js';

const stats: Stats = {
  count: 10,
  min: 1,
  mean: 5,
  p50: 4,
  p90: 8,
  p95: 9,
  p99: 12,
  max: 20,
  stddev: 2,
  unit: 'ms',
};
const tp: Throughput = { rps: 100, completed: 10, errors: 1, errorRate: 0.1 };

describe('parseDuration', () => {
  it('parses bare ms, ms suffix, and s suffix', () => {
    expect(parseDuration('80')).toBe(80);
    expect(parseDuration('200ms')).toBe(200);
    expect(parseDuration('1.5s')).toBe(1500);
    expect(parseDuration(50)).toBe(50);
  });

  it('throws UsageError on garbage', () => {
    expect(() => parseDuration('fast')).toThrow(UsageError);
  });
});

describe('parseExpr', () => {
  it('parses metric, operator, and bound', () => {
    expect(parseExpr('p95<200ms')).toEqual({ metric: 'p95', op: '<', bound: 200 });
    expect(parseExpr('errorRate<=0')).toEqual({ metric: 'errorRate', op: '<=', bound: 0 });
    expect(parseExpr('p99 <= 1.5s')).toEqual({ metric: 'p99', op: '<=', bound: 1500 });
  });

  it('rejects unknown metrics and malformed expressions', () => {
    expect(() => parseExpr('p100<5ms')).toThrow(UsageError);
    expect(() => parseExpr('p95')).toThrow(UsageError);
  });
});

describe('evaluate', () => {
  it('passes when within budget and fails when over', () => {
    expect(evaluateExpr('p95<10ms', stats, tp).pass).toBe(true);
    expect(evaluateExpr('p95<5ms', stats, tp).pass).toBe(false);
  });

  it('reads errorRate from throughput', () => {
    const r = evaluateExpr('errorRate<=0', stats, tp);
    expect(r.actual).toBe(0.1);
    expect(r.pass).toBe(false);
  });

  it('fails closed when the metric is unavailable (no stats)', () => {
    const r = evaluate({ metric: 'p95', op: '<', bound: 100 }, null, tp);
    expect(r.actual).toBeNull();
    expect(r.pass).toBe(false);
  });
});
