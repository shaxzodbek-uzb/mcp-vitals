import { describe, expect, it } from 'vitest';
import { asBenchRun, compareRuns, parseRegressionExpr, type BenchRun } from '../../src/compare.js';
import { UsageError } from '../../src/errors.js';
import type { Stats } from '../../src/types.js';

function stats(over: Partial<Stats> = {}): Stats {
  return {
    count: 50,
    min: 5,
    mean: 10,
    p50: 10,
    p90: 18,
    p95: 20,
    p99: 30,
    max: 40,
    stddev: 2,
    unit: 'ms',
    ...over,
  };
}

function run(warm: Stats | null, over: Partial<BenchRun> = {}): BenchRun {
  return {
    target: { kind: 'tool', name: 'search' },
    coldStartMs: 100,
    warm,
    throughput: { rps: 100, completed: 50, errors: 0, errorRate: 0 },
    ...over,
  };
}

function deltaFor(c: ReturnType<typeof compareRuns>, metric: string) {
  return c.deltas.find((d) => d.metric === metric);
}

describe('parseRegressionExpr', () => {
  it('parses percentage bounds', () => {
    expect(parseRegressionExpr('p95>+10%')).toMatchObject({
      metric: 'p95',
      op: '>',
      bound: 10,
      unit: 'percent',
    });
  });

  it('parses millisecond bounds', () => {
    expect(parseRegressionExpr('p99>+20ms')).toMatchObject({ bound: 20, unit: 'ms' });
    expect(parseRegressionExpr('p99>+1s')).toMatchObject({ bound: 1000, unit: 'ms' });
  });

  it('defaults a bare number to a percentage', () => {
    expect(parseRegressionExpr('p50>5')).toMatchObject({ bound: 5, unit: 'percent' });
  });

  it('accepts negative bounds, so an improvement can be asserted', () => {
    expect(parseRegressionExpr('p95>-5%')).toMatchObject({ bound: -5, op: '>' });
  });

  it('tolerates whitespace', () => {
    expect(parseRegressionExpr('p95 > +10 %')).toMatchObject({ metric: 'p95', bound: 10 });
  });

  it('rejects unknown metrics', () => {
    expect(() => parseRegressionExpr('throughput>+10%')).toThrow(UsageError);
  });

  it('rejects a malformed bound', () => {
    expect(() => parseRegressionExpr('p95>slower')).toThrow(UsageError);
  });

  it('rejects an expression with no operator', () => {
    expect(() => parseRegressionExpr('p95')).toThrow(UsageError);
  });
});

describe('compareRuns deltas', () => {
  it('computes absolute and percentage change per metric', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 25 })));
    const d = deltaFor(c, 'p95');
    expect(d?.baseline).toBe(20);
    expect(d?.current).toBe(25);
    expect(d?.delta).toBe(5);
    expect(d?.deltaPct).toBeCloseTo(25);
  });

  it('reports an improvement as a negative delta', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 15 })));
    expect(deltaFor(c, 'p95')?.delta).toBe(-5);
    expect(deltaFor(c, 'p95')?.deltaPct).toBeCloseTo(-25);
  });

  it('leaves the percentage null when the baseline is zero', () => {
    const c = compareRuns(run(stats({ min: 0 })), run(stats({ min: 3 })));
    const d = deltaFor(c, 'min');
    expect(d?.delta).toBe(3);
    expect(d?.deltaPct).toBeNull();
  });

  it('flags a change inside one baseline standard deviation as noise', () => {
    const c = compareRuns(run(stats({ p95: 20, stddev: 5 })), run(stats({ p95: 23 })));
    expect(deltaFor(c, 'p95')?.withinNoise).toBe(true);
  });

  it('does not flag a change beyond the baseline standard deviation', () => {
    const c = compareRuns(run(stats({ p95: 20, stddev: 1 })), run(stats({ p95: 30 })));
    expect(deltaFor(c, 'p95')?.withinNoise).toBe(false);
  });

  it('never labels errorRate as noise — a stddev in ms says nothing about a fraction', () => {
    const baseline = run(stats({ stddev: 100 }), {
      throughput: { rps: 1, completed: 50, errors: 0, errorRate: 0 },
    });
    const current = run(stats(), {
      throughput: { rps: 1, completed: 50, errors: 5, errorRate: 0.1 },
    });
    expect(deltaFor(compareRuns(baseline, current), 'errorRate')?.withinNoise).toBe(false);
  });

  it('compares errorRate from throughput, not from the latency stats', () => {
    const current = run(stats(), {
      throughput: { rps: 1, completed: 50, errors: 5, errorRate: 0.1 },
    });
    expect(deltaFor(compareRuns(run(stats()), current), 'errorRate')?.delta).toBeCloseTo(0.1);
  });

  it('handles a run with no successful samples', () => {
    const c = compareRuns(run(stats()), run(null));
    expect(deltaFor(c, 'p95')?.current).toBeNull();
    expect(deltaFor(c, 'p95')?.delta).toBeNull();
  });

  it('compares cold start when both runs have one', () => {
    const c = compareRuns(run(stats(), { coldStartMs: 100 }), run(stats(), { coldStartMs: 150 }));
    expect(c.coldStart?.delta).toBe(50);
    expect(c.coldStart?.deltaPct).toBeCloseTo(50);
  });

  it('omits cold start when either run lacks it', () => {
    expect(compareRuns(run(stats(), { coldStartMs: null }), run(stats())).coldStart).toBeNull();
  });
});

describe('compareRuns gating', () => {
  it('is a report with no expressions', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 200 })));
    expect(c.ok).toBe(true);
    expect(c.outcomes).toEqual([]);
  });

  it('fails when a percentage regression exceeds the bound', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 25 })), [
      parseRegressionExpr('p95>+10%'),
    ]);
    expect(c.ok).toBe(false);
    expect(c.outcomes[0]?.actual).toBeCloseTo(25);
  });

  it('passes when the regression is inside the bound', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 21 })), [
      parseRegressionExpr('p95>+10%'),
    ]);
    expect(c.ok).toBe(true);
  });

  it('passes on an improvement', () => {
    const c = compareRuns(run(stats({ p95: 20 })), run(stats({ p95: 10 })), [
      parseRegressionExpr('p95>+10%'),
    ]);
    expect(c.ok).toBe(true);
  });

  it('gates on a millisecond delta', () => {
    const exprs = [parseRegressionExpr('p99>+5ms')];
    expect(compareRuns(run(stats({ p99: 30 })), run(stats({ p99: 34 })), exprs).ok).toBe(true);
    expect(compareRuns(run(stats({ p99: 30 })), run(stats({ p99: 36 })), exprs).ok).toBe(false);
  });

  it('fails only when every expression is satisfied', () => {
    const c = compareRuns(run(stats({ p50: 10, p95: 20 })), run(stats({ p50: 10, p95: 40 })), [
      parseRegressionExpr('p50>+10%'),
      parseRegressionExpr('p95>+10%'),
    ]);
    expect(c.outcomes.map((o) => o.pass)).toEqual([true, false]);
    expect(c.ok).toBe(false);
  });

  it('passes a metric missing from either run rather than failing closed', () => {
    // "the baseline predates this metric" must not be a red build.
    const c = compareRuns(run(null), run(stats()), [parseRegressionExpr('p95>+10%')]);
    expect(c.outcomes[0]?.actual).toBeNull();
    expect(c.ok).toBe(true);
  });

  it('reports a passing gate as within noise when it is', () => {
    const c = compareRuns(run(stats({ p95: 20, stddev: 5 })), run(stats({ p95: 22 })), [
      parseRegressionExpr('p95>+50%'),
    ]);
    expect(c.outcomes[0]?.pass).toBe(true);
    expect(c.outcomes[0]?.withinNoise).toBe(true);
  });

  it('flags a short baseline as unreliable to gate on', () => {
    expect(compareRuns(run(stats({ count: 10 })), run(stats())).baselineNoisy).toBe(true);
    expect(compareRuns(run(stats({ count: 50 })), run(stats())).baselineNoisy).toBe(false);
  });
});

describe('asBenchRun', () => {
  it('accepts bench --json output', () => {
    expect(asBenchRun({ warm: null }, 'x.json')).toEqual({ warm: null });
  });

  it('rejects a non-object', () => {
    expect(() => asBenchRun('nope', 'x.json')).toThrow(UsageError);
    expect(() => asBenchRun(null, 'x.json')).toThrow(UsageError);
  });

  it('rejects JSON that is not a bench run, naming the command that produces one', () => {
    expect(() => asBenchRun({ hello: 'world' }, 'x.json')).toThrow(/bench --json/);
  });
});
