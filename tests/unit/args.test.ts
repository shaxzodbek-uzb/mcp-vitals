import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveArgs } from '../../src/args.js';
import { UsageError } from '../../src/errors.js';

const dir = mkdtempSync(join(tmpdir(), 'mcp-vitals-args-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveArgs', () => {
  it('defaults empty/undefined to {}', async () => {
    expect(await resolveArgs(undefined)).toEqual({});
    expect(await resolveArgs('')).toEqual({});
  });

  it('parses inline JSON', async () => {
    expect(await resolveArgs('{"text":"hi","n":3}')).toEqual({ text: 'hi', n: 3 });
  });

  it('reads JSON from @file', async () => {
    const file = join(dir, 'args.json');
    writeFileSync(file, '{"weightKg":70}');
    expect(await resolveArgs('@' + file)).toEqual({ weightKg: 70 });
  });

  it('throws UsageError on malformed JSON', async () => {
    await expect(resolveArgs('{not json')).rejects.toBeInstanceOf(UsageError);
  });

  it('throws UsageError on a missing @file', async () => {
    await expect(resolveArgs('@' + join(dir, 'nope.json'))).rejects.toBeInstanceOf(UsageError);
  });
});
