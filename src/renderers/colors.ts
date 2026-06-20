import pc from 'picocolors';

export type Colors = ReturnType<typeof pc.createColors>;

/** Build a picocolors instance honoring our resolved color decision. */
export function makeColors(enabled: boolean): Colors {
  return pc.createColors(enabled);
}

/**
 * Decide whether to emit ANSI color: explicit --no-color and NO_COLOR win,
 * otherwise only when stdout is a TTY.
 */
export function resolveColor(noColor: boolean): boolean {
  if (noColor) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return process.stdout.isTTY === true;
}
