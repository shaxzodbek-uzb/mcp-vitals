import { describe, expect, it } from 'vitest';
import { matchesAny, matchesGlob } from '../../src/glob.js';

describe('matchesGlob', () => {
  it('matches * across any characters', () => {
    expect(matchesGlob('echo-fast/p95', 'echo-fast/*')).toBe(true);
    expect(matchesGlob('echo-fast/p95', '*/p95')).toBe(true);
    expect(matchesGlob('echo-fast/p95', 'slow/*')).toBe(false);
  });

  it('matches ? as a single character', () => {
    expect(matchesGlob('p95', 'p9?')).toBe(true);
    expect(matchesGlob('p950', 'p9?')).toBe(false);
  });

  it('treats regex metacharacters in the glob as literals', () => {
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
    expect(matchesGlob('axb', 'a.b')).toBe(false);
    expect(matchesGlob('a+b', 'a+b')).toBe(true);
  });

  it('does not catastrophically backtrack (no ReDoS) on pathological globs', () => {
    const start = performance.now();
    expect(matchesGlob('a'.repeat(60), '*'.repeat(20) + 'x')).toBe(false);
    expect(matchesGlob('a'.repeat(50), 'a*a*a*a*a*a*a*a*b')).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('matchesAny', () => {
  it('returns true for an empty/undefined glob list', () => {
    expect(matchesAny('anything', undefined)).toBe(true);
    expect(matchesAny('anything', [])).toBe(true);
  });

  it('returns true when any glob matches', () => {
    expect(matchesAny('tools/echo', ['resources/*', 'tools/*'])).toBe(true);
    expect(matchesAny('tools/echo', ['resources/*'])).toBe(false);
  });
});
