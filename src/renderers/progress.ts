import { writeErr } from '../output.js';

const ERASE_LINE = '\r[2K';

export interface ProgressOptions {
  quiet: boolean;
  json: boolean;
}

/**
 * Stderr-only progress reporter. No-ops under --quiet. Output always goes to
 * stderr so --json stdout stays a single clean object.
 */
export class Progress {
  private readonly enabled: boolean;

  constructor(opts: ProgressOptions) {
    this.enabled = !opts.quiet;
  }

  note(message: string): void {
    if (this.enabled) writeErr(message);
  }

  /** Emit a one-line status that overwrites in place on a TTY. */
  status(message: string): void {
    if (!this.enabled) return;
    if (process.stderr.isTTY) {
      process.stderr.write(`\r${message}`);
    }
  }

  clearStatus(): void {
    if (this.enabled && process.stderr.isTTY) {
      process.stderr.write(ERASE_LINE);
    }
  }
}
