// JSON Schema (Draft 2020-12) for mcp-vitals.{yaml,yml,json}.
// Source of truth; schema/assertions.schema.json is a published copy of this object.

const threshold = { type: ['string', 'number'] };

export const ASSERTIONS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://unpkg.com/mcp-vitals/schema/assertions.schema.json',
  title: 'mcp-vitals assertions',
  type: 'object',
  additionalProperties: false,
  required: ['server'],
  properties: {
    $schema: { type: 'string' },
    server: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        transport: { enum: ['stdio', 'http', 'sse'] },
        connectTimeoutMs: { type: 'number' },
        timeoutMs: { type: 'number' },
      },
    },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: {
        iterations: { type: 'number' },
        warmup: { type: 'number' },
        concurrency: { type: 'number' },
        timeoutMs: { type: 'number' },
      },
    },
    expect: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tools: { type: 'array', items: { type: 'string' } },
        resources: { type: 'array', items: { type: 'string' } },
        prompts: { type: 'array', items: { type: 'string' } },
        schemasValid: { type: 'boolean' },
      },
    },
    latency: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          tool: { type: 'string' },
          probe: { enum: ['listTools', 'listResources', 'listPrompts'] },
          args: {},
          iterations: { type: 'number' },
          warmup: { type: 'number' },
          concurrency: { type: 'number' },
          p50: threshold,
          p90: threshold,
          p95: threshold,
          p99: threshold,
          max: threshold,
          mean: threshold,
          errorRate: { type: 'number' },
        },
      },
    },
  },
} as const;
