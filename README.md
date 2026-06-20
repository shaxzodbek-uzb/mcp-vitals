# mcp-vitals

> **Vital signs for your MCP server.** Inspect capabilities, **benchmark tool-call latency (p50/p95/p99)**, and **assert health in CI** — the `ab` / `k6` / `pytest` for [Model Context Protocol](https://modelcontextprotocol.io) servers. Non-interactive, scriptable, no LLM key required.

[![CI](https://github.com/shaxzodbek-uzb/mcp-vitals/actions/workflows/ci.yml/badge.svg)](https://github.com/shaxzodbek-uzb/mcp-vitals/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-vitals.svg)](https://www.npmjs.com/package/mcp-vitals)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```bash
# Benchmark a tool's latency — no install, no API key
npx mcp-vitals bench --tool search --args '{"q":"hello"}' npx your-mcp-server
```

```
Target: search (tool)
Server: npx your-mcp-server via stdio
Load:   50 iters, concurrency 1, warmup 1

Cold start  41.8 ms

   min    mean     p50     p90     p95     p99     max  stddev
 6.1 ms  8.0 ms  7.6 ms  9.9 ms  11.4 ms  18.7 ms  22.0 ms  2.4 ms

50 completed · 124.6 req/s · 0 errors
```

---

## Why mcp-vitals?

There are great tools for *exploring* an MCP server interactively. There is nothing for **measuring** one and **gating CI** on the result.

| | [Inspector](https://github.com/modelcontextprotocol/inspector) | [mcpjam](https://github.com/MCPJam/inspector) | [mcp-probe](https://github.com/conikeec/mcp-probe) | **mcp-vitals** |
|---|:---:|:---:|:---:|:---:|
| Inspect tools / resources / prompts | ✅ | ✅ | ✅ | ✅ |
| One-shot tool call | ✅ | ✅ | ✅ | ✅ |
| **Latency percentiles (p50/p95/p99)** | ❌ | ❌ | ❌ | **✅** |
| **Concurrency / throughput load** | ❌ | ❌ | ❌ | **✅** |
| **Gate a PR on a latency budget** | ❌ | ❌ | ❌ | **✅** |
| LLM-free (no API key) | ✅ | ❌ | ✅ | ✅ |
| `npx`-installable | ✅ | ✅ | cargo | ✅ |
| JUnit + JSON reporters | ❌ | ✅ | partial | ✅ |

mcp-vitals measures the **real `tools/call` round-trip** with `process.hrtime` — pure protocol latency, no model inference mixed in — and lets you commit a `mcp-vitals.yaml` that fails the build when a tool goes missing, ships an invalid schema, or blows its latency budget.

## Install

```bash
npx mcp-vitals --help        # zero-install
npm i -g mcp-vitals          # or install globally
```

Requires Node.js ≥ 20.

## Commands

mcp-vitals connects to any MCP server over **stdio** (a launch command), **Streamable HTTP**, or **SSE** (`--url`).

> Put mcp-vitals options *before* the server command: `mcp-vitals bench --tool x -n 100 npx your-server`.

### `bench` — latency benchmark (the headline)

```bash
# 200 iterations, 5 warmup, fail the command if p95 exceeds 200ms
mcp-vitals bench --tool search --args '{"q":"test"}' \
  -n 200 -w 5 --fail-on 'p95<200ms' --fail-on 'errorRate<=0' \
  npx your-mcp-server

# Load test: keep 10 calls in flight
mcp-vitals bench --tool search -c 10 -n 500 npx your-mcp-server

# Baseline raw transport overhead with a no-arg probe
mcp-vitals bench --probe listTools npx your-mcp-server
```

Reports `min / mean / p50 / p90 / p95 / p99 / max / stddev`, cold-start, throughput, and error rate. `--json` emits the full distribution for dashboards.

### `check` — the CI gate

Commit a `mcp-vitals.yaml` next to your server and run one line in CI:

```bash
mcp-vitals check --junit report.xml
```

```
Capabilities
CHECK        EXPECTED       ACTUAL   STATUS
tools/search tools present  present  PASS

Latency SLAs
CHECK            EXPECTED         ACTUAL    STATUS
search/p95       p95 <= 200 ms    182 ms    PASS
search/errorRate errorRate <= 0%  0.0%      PASS

3 passed, 0 failed, 0 skipped in 4.21s
```

See [the assertions file format](#assertions-file-mcp-vitalsyaml) below.

### `inspect` — discover & validate

```bash
mcp-vitals inspect npx your-mcp-server          # capabilities + tools/resources/prompts
mcp-vitals inspect --json npx your-mcp-server    # machine-readable
```

Lists everything the server exposes and **validates every tool's `inputSchema`** is valid JSON Schema (exit 2 on any invalid).

### `call` — invoke one tool

```bash
mcp-vitals call --tool search --args '{"q":"hello"}' npx your-mcp-server
mcp-vitals call --tool search --args @query.json --raw npx your-mcp-server | jq
```

### `ping` — handshake latency / liveness

```bash
mcp-vitals ping npx your-mcp-server              # connected in 142 ms
mcp-vitals ping -n 20 npx your-mcp-server        # distribution over 20 handshakes
```

## Transports & auth

```bash
# stdio (default): the trailing command launches the server
mcp-vitals inspect node dist/server.js

# Streamable HTTP / SSE (auto-falls back to SSE)
mcp-vitals inspect --url https://api.example.com/mcp \
  --header "Authorization: Bearer $TOKEN"

# inject env into a stdio child (allowlisted by default)
mcp-vitals bench --tool search --env API_KEY=$API_KEY npx your-mcp-server
```

## Assertions file (`mcp-vitals.yaml`)

Auto-discovered as `mcp-vitals.{yaml,yml,json}` in the working directory. `${VAR}` values expand from the environment, so secrets stay out of the file.

```yaml
$schema: https://unpkg.com/mcp-vitals/schema/assertions.schema.json

server:
  command: node
  args: ["dist/server.js"]
  # url: https://api.example.com/mcp
  # headers: { Authorization: "Bearer ${MCP_TOKEN}" }

defaults:
  iterations: 100
  warmup: 3

expect:
  tools: [search, fetch-url]
  schemasValid: true        # every listed tool's inputSchema must be valid

latency:
  - id: search-fast
    tool: search
    args: { q: "ping" }
    p95: 200ms              # bare numbers are ms; '1.5s' also works
    p99: 500ms
    errorRate: 0            # 0 = no tool errors allowed

  - id: handshake
    probe: listTools
    p95: 100ms
```

Add it to CI — see [`examples/github-actions.yml`](examples/github-actions.yml).

## Exit codes

mcp-vitals uses **distinct exit codes** so a pipeline can branch on the failure class:

| Code | Meaning |
|:---:|---|
| `0` | success — all assertions passed |
| `2` | **health/assertion failed** — SLA exceeded, tool errored, or invalid schema (the "red build") |
| `3` | **connection failed** — couldn't connect / handshake (infra, distinct from a bad server) |
| `4` | usage error — bad/conflicting flags or malformed `--args` |
| `5` | tool error — a single `call` returned `isError` (without `--expect-error`) |
| `6` | config error — assertions file missing / unparseable / invalid |

## JSON & scripting

Every command supports `--json` for a single, self-contained object on stdout (everything else goes to stderr, so `| jq` always works):

```bash
mcp-vitals bench --tool search -n 100 --json npx your-mcp-server | jq '.warm.p95'
```

## Library use

```ts
import { Connection, runBench, computeStats } from 'mcp-vitals';

const conn = await Connection.connect({
  command: 'npx', args: ['your-mcp-server'], headers: {}, env: {},
  inheritEnv: false, connectTimeoutMs: 10_000, requestTimeoutMs: 10_000,
});
const result = await runBench(conn, {
  targetKind: 'tool', targetName: 'search', args: { q: 'hi' },
  iterations: 100, warmup: 3, concurrency: 1, keepAlive: true,
}, 10_000);
console.log(result.warm?.p95);
await conn.close();
```

## Notes on benchmarking

Latency numbers are only as stable as the host. Run benchmarks on a quiet machine, always keep a warmup (cold-start is reported separately), and watch `stddev` to spot a noisy environment. mcp-vitals' own test suite gates on **relative** ordering, not absolute milliseconds — a good practice for your CI thresholds too (set budgets with headroom).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE) © Shaxzodbek Qambaraliyev / Blaze
