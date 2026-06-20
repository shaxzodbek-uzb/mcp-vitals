import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Connection } from '../../src/mcpClient.js';
import { runBench } from '../../src/bench/engine.js';
import { createFixtureServer } from '../fixtures/fixture-server.js';
import type { BenchConfig } from '../../src/types.js';

let conn: Connection;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createFixtureServer().connect(serverTransport);
  const client = new Client({ name: 'mcp-vitals-test', version: '0.0.0' });
  await client.connect(clientTransport);
  conn = Connection.fromClient(client);
});

afterAll(async () => {
  await conn?.close();
});

function toolConfig(name: string, args: unknown, extra: Partial<BenchConfig> = {}): BenchConfig {
  return {
    targetKind: 'tool',
    targetName: name,
    args,
    iterations: 20,
    warmup: 3,
    concurrency: 1,
    keepAlive: true,
    ...extra,
  };
}

describe('runBench', () => {
  it('measures exactly N warm samples and surfaces cold start', async () => {
    const r = await runBench(conn, toolConfig('echo', { text: 'hi' }), 5000);
    expect(r.warm?.count).toBe(20);
    expect(r.coldStartMs).not.toBeNull();
    expect(r.throughput.completed).toBe(20);
    expect(r.throughput.errors).toBe(0);
    expect(r.throughput.errorRate).toBe(0);
  });

  it('computes errorRate from tool-level errors (boom)', async () => {
    const r = await runBench(conn, toolConfig('boom', {}, { warmup: 0 }), 5000);
    expect(r.throughput.completed).toBe(20);
    expect(r.throughput.errors).toBe(20);
    expect(r.throughput.errorRate).toBe(1);
    // tool errors are real round-trips, so they still carry latency samples
    expect(r.warm?.count).toBe(20);
  });

  it('honors concurrency while still completing every iteration', async () => {
    const r = await runBench(conn, toolConfig('echo', { text: 'x' }, { concurrency: 4 }), 5000);
    expect(r.throughput.completed).toBe(20);
  });

  it('orders latency correctly: slow > echo (relative, not absolute)', async () => {
    const fast = await runBench(conn, toolConfig('echo', { text: 'x' }), 5000);
    const slow = await runBench(conn, toolConfig('slow', { delayMs: 15 }), 5000);
    expect(slow.warm!.p95).toBeGreaterThan(fast.warm!.p95);
    expect(slow.warm!.mean).toBeGreaterThan(10); // ~15ms sleep
  });

  it('supports no-arg probe benchmarks', async () => {
    const r = await runBench(
      conn,
      { targetKind: 'probe', targetName: 'listTools', args: {}, iterations: 10, warmup: 1, concurrency: 1, keepAlive: true },
      5000,
    );
    expect(r.warm?.count).toBe(10);
    expect(r.throughput.errors).toBe(0);
  });
});
