import { readFile } from 'node:fs/promises';
import { UsageError } from './errors.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Resolve a `--args` value into a parsed JSON object.
 * - undefined / empty  => `{}`
 * - `-`                => read JSON from stdin
 * - `@path`            => read JSON from a file
 * - otherwise          => inline JSON
 * Malformed JSON throws a UsageError (exit 4).
 */
export async function resolveArgs(input: string | undefined): Promise<unknown> {
  if (input === undefined || input === '') return {};

  let text: string;
  let source: string;
  if (input === '-') {
    text = await readStdin();
    source = 'stdin';
  } else if (input.startsWith('@')) {
    const path = input.slice(1);
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      throw new UsageError(`cannot read --args file "${path}": ${(err as Error).message}`);
    }
    source = `file "${path}"`;
  } else {
    text = input;
    source = 'inline JSON';
  }

  const trimmed = text.trim();
  if (trimmed === '') return {};
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new UsageError(`invalid JSON from ${source}: ${(err as Error).message}`);
  }
}
