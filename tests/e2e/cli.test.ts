import { describe, expect, it } from 'vitest';
import { execa } from 'execa';

const BIN = 'bin/mcp-vitals.js';
const SERVER = ['node_modules/.bin/tsx', 'tests/fixtures/fixture-server.ts'];

function run(args: string[]) {
  return execa('node', [BIN, ...args], { reject: false });
}

describe('CLI exit codes & stdout discipline', () => {
  it('inspect against a bad inputSchema exits 2', async () => {
    const { exitCode } = await run(['inspect', '--no-color', ...SERVER]);
    expect(exitCode).toBe(2);
  });

  it('inspect --json emits exactly one parseable JSON object on stdout', async () => {
    const { stdout, exitCode } = await run(['inspect', '--json', ...SERVER]);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false); // bad-schema present
    expect(parsed.summary.tools).toBe(5);
    expect(parsed.summary.schemasInvalid).toBe(1);
    expect(exitCode).toBe(2);
  });

  it('call boom exits 5', async () => {
    const { exitCode } = await run(['call', '--tool', 'boom', '--no-color', ...SERVER]);
    expect(exitCode).toBe(5);
  });

  it('call boom --expect-error exits 0', async () => {
    const { exitCode } = await run(['call', '--tool', 'boom', '--expect-error', '--no-color', ...SERVER]);
    expect(exitCode).toBe(0);
  });

  it('bench --fail-on a blown SLA exits 2', async () => {
    const { exitCode } = await run([
      'bench', '--tool', 'slow', '--args', '{"delayMs":20}', '-n', '6', '--fail-on', 'p95<1ms', '--no-color', ...SERVER,
    ]);
    expect(exitCode).toBe(2);
  });

  it('bench within a generous SLA exits 0', async () => {
    const { exitCode } = await run([
      'bench', '--tool', 'echo', '--args', '{"text":"x"}', '-n', '10', '--fail-on', 'p95<5000ms', '--no-color', ...SERVER,
    ]);
    expect(exitCode).toBe(0);
  });

  it('bench --json keeps stdout clean for jq', async () => {
    const { stdout } = await run(['bench', '--tool', 'echo', '--args', '{"text":"x"}', '-n', '8', '--json', ...SERVER]);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.warm.count).toBe(8);
    expect(parsed.target).toEqual({ kind: 'tool', name: 'echo' });
  });

  it('passing both a stdio command and --url is a usage error (exit 4)', async () => {
    const { exitCode } = await run(['inspect', '--url', 'http://localhost:9/mcp', ...SERVER]);
    expect(exitCode).toBe(4);
  });

  it('an unreachable server exits 3', async () => {
    const { exitCode } = await run(['inspect', '--no-color', 'this-command-does-not-exist-xyz']);
    expect(exitCode).toBe(3);
  });

  it('an unknown option is a usage error (exit 4)', async () => {
    const { exitCode } = await run(['inspect', '--definitely-not-a-flag', ...SERVER]);
    expect(exitCode).toBe(4);
  });

  it('rejects invalid numeric flags instead of silently running zero samples', async () => {
    for (const args of [
      ['bench', '--tool', 'echo', '-n', 'abc', ...SERVER],
      ['bench', '--tool', 'echo', '-n', '0', ...SERVER],
      ['bench', '--tool', 'echo', '-n', '-5', ...SERVER],
      ['bench', '--tool', 'echo', '-c', 'abc', ...SERVER],
      ['bench', '--tool', 'echo', '--rps', 'abc', ...SERVER],
      ['ping', '-n', 'abc', ...SERVER],
    ]) {
      const { exitCode } = await run(args);
      expect(exitCode, args.join(' ')).toBe(4);
    }
  });

  it('still allows --warmup 0 (cold-start disabled)', async () => {
    const { exitCode } = await run(['bench', '--tool', 'echo', '-n', '5', '-w', '0', '--no-color', ...SERVER]);
    expect(exitCode).toBe(0);
  });

  it('flags an mcp-vitals option placed after the server command (footgun guard)', async () => {
    const { exitCode } = await run(['inspect', ...SERVER, '--json']);
    expect(exitCode).toBe(4);
  });

  it('lets `--` pass a look-alike flag through to the server (escape hatch)', async () => {
    // `--json` after `--` is for the child, so the footgun guard must NOT fire (no exit 4).
    const { exitCode } = await run(['inspect', '--no-color', ...SERVER, '--', '--json']);
    expect(exitCode).toBe(2); // bad-schema → 2, importantly not 4
  });
});
