// Typed error classes mapped to stable exit codes (see SPEC §6).

export const EXIT_CODES = {
  SUCCESS: 0,
  ASSERTION: 2,
  CONNECTION: 3,
  USAGE: 4,
  TOOL_ERROR: 5,
  CONFIG: 6,
} as const;

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

/** Bad/conflicting flags, malformed --args JSON, etc. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.USAGE);
  }
}

/** Could not connect / handshake / initialize. */
export class ConnectionError extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.CONNECTION);
  }
}

/** A `--fail-on` / `check` assertion failed, SLA exceeded, or an invalid schema. */
export class AssertionFailure extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.ASSERTION);
  }
}

/** A single `call` returned isError:true without --expect-error. */
export class ToolErrorExit extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.TOOL_ERROR);
  }
}

/** check assertions file missing / unparseable / schema-invalid. */
export class ConfigError extends CliError {
  constructor(message: string) {
    super(message, EXIT_CODES.CONFIG);
  }
}

export function toExitCode(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;
  return 1;
}
