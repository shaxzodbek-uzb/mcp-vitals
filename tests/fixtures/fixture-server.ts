import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';

// Tool catalog. `bad-schema` keeps type:"object" (required by the MCP Tool
// schema) but nests an invalid sub-schema that Ajv rejects — exercising the
// inputSchema-validity path without breaking the protocol-level listTools.
const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the provided text (fast deterministic baseline).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'slow',
    description: 'Sleep delayMs then return — drives latency-threshold tests.',
    inputSchema: {
      type: 'object',
      properties: { delayMs: { type: 'number' } },
    },
  },
  {
    name: 'boom',
    description: 'Always returns an MCP tool error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bad-schema',
    description: 'Has a structurally invalid inputSchema.',
    inputSchema: {
      type: 'object',
      properties: { broken: { type: 'not-a-real-json-schema-type' } },
    },
  },
  {
    name: 'bmi',
    description: 'Compute BMI and return structured content.',
    inputSchema: {
      type: 'object',
      properties: { weightKg: { type: 'number' }, heightM: { type: 'number' } },
      required: ['weightKg', 'heightM'],
    },
    outputSchema: {
      type: 'object',
      properties: { bmi: { type: 'number' } },
      required: ['bmi'],
    },
  },
];

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Build a fresh fixture Server (use with InMemoryTransport or stdio). */
export function createFixtureServer(): Server {
  const server = new Server(
    { name: 'fixture-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: 'file:///hello.txt', name: 'hello', mimeType: 'text/plain' }],
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: 'greet', description: 'A greeting prompt.', arguments: [{ name: 'who', required: true }] }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'echo':
        return { content: [{ type: 'text', text: String(args.text ?? '') }] };
      case 'slow': {
        const ms = Number(args.delayMs ?? 5);
        await delay(ms);
        return { content: [{ type: 'text', text: `slept ${ms}ms` }] };
      }
      case 'boom':
        return { content: [{ type: 'text', text: 'boom!' }], isError: true };
      case 'bad-schema':
        return { content: [{ type: 'text', text: 'ok' }] };
      case 'bmi': {
        const w = Number(args.weightKg ?? 0);
        const h = Number(args.heightM ?? 1);
        const bmi = w / (h * h);
        return {
          content: [{ type: 'text', text: `BMI ${bmi.toFixed(1)}` }],
          structuredContent: { bmi },
        };
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
    }
  });

  return server;
}

async function runStdio(): Promise<void> {
  const server = createFixtureServer();
  await server.connect(new StdioServerTransport());
}

// Run as a stdio server when executed directly (tsx tests/fixtures/fixture-server.ts).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStdio().catch((err) => {
    process.stderr.write(`fixture-server: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
