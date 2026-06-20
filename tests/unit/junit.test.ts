import { describe, expect, it } from 'vitest';
import { renderJUnit } from '../../src/renderers/junit.js';
import type { CheckRow, CheckSummary } from '../../src/types.js';

const rows: CheckRow[] = [
  { id: 'tools/echo', kind: 'presence', target: 'echo', expected: 'present', actual: 'present', status: 'pass' },
  { id: 'echo/p95', kind: 'latency', target: 'echo p95', expected: 'p95 <= 50 ms', actual: '120 ms', status: 'fail' },
  { id: 'handshake/p95', kind: 'latency', target: 'listTools p95', expected: 'p95 <= 100 ms', actual: 'skipped', status: 'skip' },
];
const summary: CheckSummary = { passed: 1, failed: 1, skipped: 1, durationMs: 1234 };

describe('renderJUnit', () => {
  const xml = renderJUnit(rows, summary);

  it('emits a valid testsuite header with counts', () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain('time="1.234"');
  });

  it('renders one testcase per row with failure + skipped nodes', () => {
    expect(xml).toContain('<testcase name="tools/echo"');
    expect(xml).toContain('<failure message="echo p95: expected p95 &lt;= 50 ms, got 120 ms">');
    expect(xml).toContain('<skipped/>');
  });
});
