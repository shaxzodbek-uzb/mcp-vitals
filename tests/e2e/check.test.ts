import { afterAll, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = 'bin/mcp-vitals.js';
const dir = mkdtempSync(join(tmpdir(), 'mcp-vitals-check-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[]) {
  return execa('node', [BIN, ...args], { reject: false });
}

const SERVER_BLOCK = [
  'server:',
  '  command: node_modules/.bin/tsx',
  '  args: ["tests/fixtures/fixture-server.ts"]',
].join('\n');

function writeConfig(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe('check command E2E', () => {
  it('passes the bundled example (exit 0)', async () => {
    const { exitCode } = await run(['check', '-c', 'examples/mcp-vitals.yaml', '--no-color']);
    expect(exitCode).toBe(0);
  });

  it('fails a blown latency SLA (exit 2)', async () => {
    const path = writeConfig(
      'fail.yaml',
      [SERVER_BLOCK, 'latency:', '  - id: slow-sla', '    tool: slow', '    args: { delayMs: 25 }', '    p95: 1ms', '    iterations: 6'].join('\n'),
    );
    const { exitCode } = await run(['check', '-c', path, '--no-color']);
    expect(exitCode).toBe(2);
  });

  it('reports a missing config (exit 6)', async () => {
    const { exitCode } = await run(['check', '-c', join(dir, 'nope.yaml'), '--no-color']);
    expect(exitCode).toBe(6);
  });

  it('reports an unreachable server (exit 3)', async () => {
    const path = writeConfig('unreach.yaml', 'server:\n  command: this-command-does-not-exist-xyz\n');
    const { exitCode } = await run(['check', '-c', path, '--no-color']);
    expect(exitCode).toBe(3);
  });

  it('writes a JUnit report file', async () => {
    const report = join(dir, 'report.xml');
    const { exitCode } = await run(['check', '-c', 'examples/mcp-vitals.yaml', '--junit', report, '--no-color']);
    expect(exitCode).toBe(0);
    const xml = readFileSync(report, 'utf8');
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('classname="mcp-vitals.latency"');
  });

  it('rejects --json with --junit - (both write stdout) as a usage error', async () => {
    const { exitCode, stdout } = await run(['check', '-c', 'examples/mcp-vitals.yaml', '--json', '--junit', '-']);
    expect(exitCode).toBe(4);
    expect(stdout).toBe('');
  });

  it('--json emits a clean machine-readable summary', async () => {
    const { stdout, exitCode } = await run(['check', '-c', 'examples/mcp-vitals.yaml', '--json']);
    const parsed = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.failed).toBe(0);
    expect(Array.isArray(parsed.suites)).toBe(true);
  });
});
