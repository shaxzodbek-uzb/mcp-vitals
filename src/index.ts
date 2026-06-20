// Public library surface. The CLI is the primary interface, but the protocol
// client, bench engine, stats, and assertion runner are exported for reuse.

export { Connection } from './mcpClient.js';
export type { CallResult } from './mcpClient.js';
export { runBench } from './bench/engine.js';
export type { BenchHooks } from './bench/engine.js';
export { computeStats, percentile } from './stats.js';
export { parseExpr, parseDuration, evaluate, evaluateExpr } from './thresholds.js';
export { validateJsonSchema } from './schema.js';
export { loadConfig, discoverConfig } from './assertions/loader.js';
export { runChecks } from './assertions/run.js';
export { main, buildProgram } from './cli.js';
export { EXIT_CODES } from './errors.js';
export type * from './types.js';
