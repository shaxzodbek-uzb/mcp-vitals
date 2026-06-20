import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Connection } from '../../src/mcpClient.js';
import { validateJsonSchema } from '../../src/schema.js';
import { createFixtureServer } from '../fixtures/fixture-server.js';

let conn: Connection;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createFixtureServer().connect(serverTransport);
  const client = new Client({ name: 'mcp-vitals-test', version: '0.0.0' });
  await client.connect(clientTransport);
  conn = Connection.fromClient(client, { kind: 'stdio', target: 'fixture' });
});

afterAll(async () => {
  await conn?.close();
});

describe('Connection over InMemoryTransport', () => {
  it('reports identity and capabilities', () => {
    expect(conn.identity().name).toBe('fixture-server');
    const caps = conn.capabilities();
    expect(caps.tools).toBe(true);
    expect(caps.resources).toBe(true);
    expect(caps.prompts).toBe(true);
  });

  it('lists tools with arg counts', async () => {
    const tools = await conn.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['bad-schema', 'bmi', 'boom', 'echo', 'slow']);
    const echo = tools.find((t) => t.name === 'echo')!;
    expect(echo.requiredArgs).toBe(1);
    expect(echo.totalArgs).toBe(1);
  });

  it('lists resources and prompts', async () => {
    expect((await conn.listResources())[0]?.name).toBe('hello');
    expect((await conn.listPrompts())[0]?.name).toBe('greet');
  });

  it('calls a tool returning text', async () => {
    const r = await conn.callTool('echo', { text: 'hi there' });
    expect(r.isError).toBe(false);
    expect(JSON.stringify(r.content)).toContain('hi there');
  });

  it('surfaces structured content', async () => {
    const r = await conn.callTool('bmi', { weightKg: 70, heightM: 1.75 });
    expect(r.isError).toBe(false);
    expect((r.structuredContent as { bmi: number }).bmi).toBeCloseTo(22.86, 1);
  });

  it('reports tool-level errors without throwing', async () => {
    const r = await conn.callTool('boom', {});
    expect(r.isError).toBe(true);
  });

  it('detects an invalid inputSchema', async () => {
    const tools = await conn.listTools();
    const bad = tools.find((t) => t.name === 'bad-schema')!;
    const good = tools.find((t) => t.name === 'echo')!;
    expect(validateJsonSchema(good.inputSchema).valid).toBe(true);
    expect(validateJsonSchema(bad.inputSchema).valid).toBe(false);
  });
});
