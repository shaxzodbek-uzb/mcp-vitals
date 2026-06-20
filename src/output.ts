// Centralized stdout/stderr writers to keep --json output pure.
// Human/result output -> stdout. Progress/logs -> stderr.

export function writeOut(line = ''): void {
  process.stdout.write(line + '\n');
}

export function writeErr(line = ''): void {
  process.stderr.write(line + '\n');
}
