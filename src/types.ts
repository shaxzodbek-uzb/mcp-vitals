// Shared types for mcp-vitals. No runtime code lives here.

export type TransportKind = 'stdio' | 'http' | 'sse';

/** How to reach the MCP server under test. */
export interface TransportSpec {
  /** Forced transport, or undefined to infer from command/url. */
  forced?: TransportKind;
  /** stdio: executable + argv. */
  command?: string;
  args: string[];
  /** http/sse: target URL. */
  url?: string;
  /** http/sse: extra request headers (auth, etc). */
  headers: Record<string, string>;
  /** stdio: extra env vars merged over getDefaultEnvironment(). */
  env: Record<string, string>;
  /** stdio: spread process.env into the child before --env vars. */
  inheritEnv: boolean;
  /** Handshake timeout (ms). */
  connectTimeoutMs: number;
  /** Per-request timeout (ms). */
  requestTimeoutMs: number;
}

/** Global options resolved once and shared by every command. */
export interface RunContext {
  json: boolean;
  color: boolean;
  quiet: boolean;
  verbose: boolean;
}

export interface SchemaError {
  path: string;
  message: string;
}

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  requiredArgs: number;
  totalArgs: number;
  schemaValid: boolean;
  schemaErrors: SchemaError[];
}

export interface ResourceInfo {
  uri: string;
  name?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments: { name: string; required?: boolean }[];
}

export interface ServerIdentity {
  name: string;
  version: string;
  protocolVersion?: string;
  instructions?: string;
}

export interface CapabilitySummary {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
  logging: boolean;
  completions: boolean;
  raw: Record<string, unknown>;
}

export interface Stats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  stddev: number;
  unit: 'ms';
}

export interface Throughput {
  rps: number;
  completed: number;
  errors: number;
  errorRate: number;
}

export type ProbeOp = 'listTools' | 'listResources' | 'listPrompts';

export interface BenchConfig {
  targetKind: 'tool' | 'probe';
  targetName: string;
  args: unknown;
  iterations?: number;
  durationMs?: number;
  warmup: number;
  concurrency: number;
  rps?: number;
  keepAlive: boolean;
}

export interface BenchSample {
  ms: number;
  error: boolean;
}

export interface BenchResult {
  coldStartMs: number | null;
  warm: Stats | null;
  throughput: Throughput;
  samples: number[];
  raw: BenchSample[];
}

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface AssertionOutcome {
  expr: string;
  metric: string;
  op: CompareOp;
  bound: number;
  actual: number | null;
  pass: boolean;
}

export type SuiteKind = 'presence' | 'schema' | 'latency';
export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckRow {
  id: string;
  kind: SuiteKind;
  target: string;
  expected: string;
  actual: string;
  status: CheckStatus;
}

export interface CheckSummary {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

// ---- Assertions config (mcp-vitals.yaml) ----

export interface ServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: TransportKind;
  connectTimeoutMs?: number;
  timeoutMs?: number;
}

export interface BenchDefaults {
  iterations?: number;
  warmup?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface ExpectConfig {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  schemasValid?: boolean;
}

export interface LatencyAssertion {
  id: string;
  tool?: string;
  probe?: ProbeOp;
  args?: unknown;
  iterations?: number;
  warmup?: number;
  concurrency?: number;
  p50?: string | number;
  p90?: string | number;
  p95?: string | number;
  p99?: string | number;
  max?: string | number;
  mean?: string | number;
  errorRate?: number;
}

export interface AssertionsConfig {
  server: ServerConfig;
  defaults?: BenchDefaults;
  expect?: ExpectConfig;
  latency?: LatencyAssertion[];
}
