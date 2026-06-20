import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandEnv, loadConfig } from '../../src/assertions/loader.js';
import { ConfigError } from '../../src/errors.js';

const dir = mkdtempSync(join(tmpdir(), 'mcp-vitals-loader-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  delete process.env.MCP_VITALS_TEST_TOKEN;
});

function writeConfig(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe('expandEnv', () => {
  it('expands ${VAR} recursively in strings', () => {
    process.env.MCP_VITALS_TEST_TOKEN = 'secret';
    const out = expandEnv({ headers: { Authorization: 'Bearer ${MCP_VITALS_TEST_TOKEN}' }, n: 5 });
    expect(out).toEqual({ headers: { Authorization: 'Bearer secret' }, n: 5 });
  });

  it('expands missing vars to empty string', () => {
    expect(expandEnv('${DEFINITELY_NOT_SET_XYZ}')).toBe('');
  });
});

describe('loadConfig', () => {
  it('loads a valid YAML config', async () => {
    const path = writeConfig(
      'mcp-vitals.yaml',
      [
        'server:',
        '  command: node',
        '  args: ["server.js"]',
        'expect:',
        '  tools: [search]',
        'latency:',
        '  - id: a',
        '    tool: search',
        '    p95: 200ms',
      ].join('\n'),
    );
    const { config } = await loadConfig(path);
    expect(config.server.command).toBe('node');
    expect(config.latency?.[0]?.id).toBe('a');
  });

  it('loads JSON too (YAML superset)', async () => {
    const path = writeConfig(
      'mcp-vitals.json',
      JSON.stringify({ server: { url: 'http://localhost:3000/mcp' } }),
    );
    const { config } = await loadConfig(path);
    expect(config.server.url).toContain('localhost');
  });

  it('rejects a config with neither command nor url (ConfigError)', async () => {
    const path = writeConfig('bad1.yaml', 'server: {}\n');
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects unknown top-level keys (additionalProperties:false)', async () => {
    const path = writeConfig('bad2.yaml', 'server:\n  command: node\nwhoops: true\n');
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects a latency assertion missing both tool and probe', async () => {
    const path = writeConfig(
      'bad3.yaml',
      ['server:', '  command: node', 'latency:', '  - id: x', '    p95: 10ms'].join('\n'),
    );
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it('throws ConfigError when no file is found', async () => {
    await expect(loadConfig(join(dir, 'does-not-exist.yaml'))).rejects.toBeInstanceOf(ConfigError);
  });
});
