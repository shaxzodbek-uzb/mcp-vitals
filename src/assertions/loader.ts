import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AssertionsConfig } from '../types.js';
import { ConfigError } from '../errors.js';
import { validateData } from '../schema.js';
import { ASSERTIONS_SCHEMA } from './schema.js';

const DISCOVERY_ORDER = ['mcp-vitals.yaml', 'mcp-vitals.yml', 'mcp-vitals.json'];

/** Find the first mcp-vitals config in `cwd`, or undefined. */
export function discoverConfig(cwd: string = process.cwd()): string | undefined {
  for (const name of DISCOVERY_ORDER) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** Expand ${VAR} from process.env in every string value, recursively. */
export function expandEnv<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      return process.env[name] ?? '';
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandEnv(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
    return out as unknown as T;
  }
  return value;
}

export async function loadConfig(explicitPath?: string): Promise<{ path: string; config: AssertionsConfig }> {
  const path = explicitPath ? resolve(explicitPath) : discoverConfig();
  if (!path) {
    throw new ConfigError(
      'no assertions file found (looked for mcp-vitals.yaml/yml/json) — pass one with -c <path>',
    );
  }
  if (!existsSync(path)) {
    throw new ConfigError(`assertions file not found: ${path}`);
  }

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${path}: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = parseYaml(text); // YAML is a superset of JSON, so this handles both.
  } catch (err) {
    throw new ConfigError(`cannot parse ${path}: ${(err as Error).message}`);
  }

  const expanded = expandEnv(data);
  const check = validateData(ASSERTIONS_SCHEMA as object, expanded);
  if (!check.valid) {
    const first = check.errors[0];
    const detail = first ? `${first.path} ${first.message}` : 'schema validation failed';
    throw new ConfigError(`invalid assertions file ${path}: ${detail}`);
  }

  const config = expanded as AssertionsConfig;
  if (!config.server.command && !config.server.url) {
    throw new ConfigError(`invalid assertions file ${path}: server must set "command" or "url"`);
  }
  for (const a of config.latency ?? []) {
    if (!a.tool && !a.probe) {
      throw new ConfigError(
        `invalid assertions file ${path}: latency assertion "${a.id}" must set "tool" or "probe"`,
      );
    }
  }

  return { path, config };
}
