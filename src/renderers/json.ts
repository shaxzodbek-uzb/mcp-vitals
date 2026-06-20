import { writeOut } from '../output.js';

/** Emit exactly one self-contained JSON object to stdout (never NDJSON). */
export function emitJson(obj: unknown): void {
  writeOut(JSON.stringify(obj, null, 2));
}
