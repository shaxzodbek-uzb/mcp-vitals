# mcp-vitals — SPEC

> **Vital signs for your MCP server.** Inspect capabilities, **benchmark tool-call latency (p50/p95/p99)**, and **assert health in CI**. The `ab` / `k6` / `pytest` for MCP servers — non-interactive, scriptable, LLM-free.

- **Package:** `mcp-vitals` (npm) · **bin:** `mcp-vitals`
- **Run:** `npx mcp-vitals bench npx your-server`
- **Author:** Shaxzodbek Sobirov <shaxzodbek@blaze.uz> · github.com/shaxzodbek-uzb/mcp-vitals · MIT
- **Runtime:** Node 20+, npm 10. ESM (`"type": "module"`, NodeNext).
- **SDK:** `@modelcontextprotocol/sdk@^1.29` (subpath imports with `.js` extensions).

---

## 1. Positioning & the wedge

The MCP tooling field has three players and one **unclaimed intersection**:

| Capability | Inspector (official) | mcpjam | mcp-probe (Rust) | **mcp-vitals** |
|---|---|---|---|---|
| Inspect tools/resources/prompts | ✅ (UI + `--cli`) | ✅ | ✅ (TUI) | ✅ `inspect` |
| One-shot tool call | ✅ | ✅ | ✅ | ✅ `call` |
| **Latency percentiles (p50/p95/p99)** | ❌ | ❌ | ❌ | ✅ **`bench`** |
| **Load / concurrency / throughput** | ❌ | ❌ | ❌ | ✅ **`bench -c/--rps`** |
| **Latency-SLA CI gate (fail on slow server)** | ❌ | ❌ (gates correctness only) | ❌ | ✅ **`check` + `--fail-on`** |
| LLM-free / no API key | ✅ | ❌ (e2e latency needs LLM key) | ✅ | ✅ |
| npx-installable | ✅ | ✅ | ❌ (cargo only) | ✅ |
| JUnit + JSON-summary reporters | ❌ | ✅ | partial | ✅ |

**The wedge:** No existing MCP-protocol-aware CLI produces a **latency distribution** of real `tools/call` round-trips, and none lets you **gate a PR on a server-side latency budget** (`--fail-on 'p95<200ms'`). mcpjam's "latency" is LLM-eval e2e latency (model inference + tool selection, requires an LLM key); mcp-probe's percentile/stress testing is unbuilt. mcp-vitals owns exactly that intersection:

> `bench` (warmup + N iterations + optional concurrency/RPS → min/mean/p50/p90/p95/p99/max/stddev + throughput, **no LLM key**) and `check` (committable SLA assertion file + strict exit codes + JUnit) are the headline. `inspect`/`call`/`ping` reach familiar parity so the tool feels like a drop-in.

**Design principles**
1. **Non-interactive & pipeline-native.** No TUI, no web UI, no prompts. Every command is a one-shot that exits with a meaningful code.
2. **Strict stdout/stderr discipline.** Human/result output → stdout. Progress, spinners, warmup notices, server stderr → **stderr**. `--json` emits a single self-contained object to stdout; nothing else pollutes it. `... --json | jq` always works.
3. **Pure-protocol latency.** Measure `tools/call` time with `process.hrtime.bigint()`. No model, no key, no eval conflation.
4. **CI as a first-class feature, not an afterthought.** Distinct exit-code classes, threshold flags, committable config, JUnit.
5. **Familiar surface.** Mirror Inspector's `--tool`/args ergonomics and mcpjam's `--transport`/`--url`/`--header` so the learning cost is near zero.

---

## 2. Transport handling

A single shared **transport resolver** powers all commands.

| Input | Inferred transport | SDK transport |
|---|---|---|
| trailing positional `cmd args...` | `stdio` | `StdioClientTransport` |
| `--url http(s)://...` | `http` (Streamable HTTP) | `StreamableHTTPClientTransport` |
| `--url ...` + connect fails | falls back to `sse` | `SSEClientTransport` |
| `--transport stdio\|http\|sse` | forces selection | — |

Rules:
- **Positional command and `--url` are mutually exclusive** → exit `4`.
- Use `--` to disambiguate server flags: `mcp-vitals bench -- npx your-server --server-flag`.
- **stdio env:** child gets `getDefaultEnvironment()` allowlist; `--env K=V` (repeatable) merged on top; `--inherit-env` spreads `process.env` first (opt-in).
- **stdio stderr:** transport built with `stderr: "pipe"` so server logs never leak into stdout/JSON; relayed to our stderr under `--verbose`.
- **HTTP headers:** `--header 'K: V'` (repeatable) → request headers (auth supported). Ignored for stdio.
- **HTTP→SSE fallback:** try Streamable HTTP first; on `connect()` rejection build a **fresh** `Client` + `SSEClientTransport`. `--transport` skips the fallback.
- **Timeouts:** `--connect-timeout` bounds handshake; `--timeout` bounds each request (exceeded = failed sample, not a crash).

**Capability gating:** after `connect()`, read `getServerVersion()`, `getServerCapabilities()`, `getInstructions()`. Only `listResources()`/`listPrompts()` when capabilities present. All list calls loop on `nextCursor` (pagination).

---

## 3. Global flags

```
[command...]              stdio server launch command + argv (mutually exclusive with --url)
--url <url>               connect over HTTP/SSE (mutually exclusive with positional cmd)
--transport <stdio|http|sse>   force transport (default: inferred)
--header <k:v>            add HTTP header to every request (repeatable; ignored for stdio)
--env <k=v>               inject env var into stdio child (repeatable; ignored for http/sse)
--inherit-env             spread process.env into the stdio child before --env vars
--timeout <ms>            per-request timeout (default 10000); exceeded = failed sample
--connect-timeout <ms>    handshake timeout (default = --timeout)
--json                    single machine-readable JSON object on stdout; all else to stderr
--no-color                disable ANSI (auto-off when stdout not a TTY or NO_COLOR set)
-q, --quiet               suppress non-error stderr progress
-v, --verbose             per-request debug timing + relay server stderr, to stderr
-V, --version  /  -h, --help
```

---

## 4. Command reference

### 4.1 `inspect` — discover & validate (read-only)
Connect, print server identity + negotiated capabilities, list tools/resources/prompts, and **validate every tool `inputSchema` is valid JSON Schema** (Ajv compile). Find the tool name you'll later `bench`/`call`.

Flags: `--tools` / `--resources` / `--prompts` (restrict kinds), `--schema` (include full inputSchema), `--no-validate-schemas` (default on; invalid → exit 2), `--filter <glob>`, `--json`.

**Exit:** `0` ok · `2` ≥1 invalid inputSchema · `3` connect fail · `4` usage.

### 4.2 `ping` — handshake latency / liveness
Measure pure connect + MCP `initialize` latency (optionally one `tools/list`). No tool invoked.

Flags: `-n, --count <N>` (reconnect cycles; >1 → distribution), `--list` (also time `tools/list`), `--json`.

**Exit:** `0` · `3` connect fail · `4` usage.

### 4.3 `bench` — THE differentiator (latency benchmark)
Latency-benchmark **one** operation: a named tool (`--tool NAME --args JSON`) or a no-arg probe (`--probe listTools|listResources|listPrompts`). Warmup iterations (excluded from warm stats, surfaced as cold-start), then N measured iterations, optionally under fixed concurrency (closed model) or target arrival rate (open model). Reports the full distribution + cold-vs-warm + throughput.

Flags:
```
--tool <name>             tool to benchmark (mutually exclusive with --probe)
--probe <listTools|listResources|listPrompts>   no-arg op (default: listTools)
--args <json>             tool args JSON; '-' = stdin, '@file.json' = file
-n, --iterations <N>      measured iterations (default 50; mutex with -d)
-w, --warmup <N>          warmup iters, reported as cold-start (default 1; 0 disables)
-c, --concurrency <N>     closed-model load: keep N in flight (default 1)
--rps <R>                 open-model load: drive R req/s arrival rate
-d, --duration <ms>       run for wall-clock duration instead of -n
--fail-on <expr>          inline SLA gate (repeatable), e.g. 'p95<200ms', 'errorRate<=0'
--json
```

**Exit:** `0` completed + all `--fail-on` passed · `2` any `--fail-on` assertion failed, or — when no `--fail-on` is given at all — errorRate>0 · `3` connect fail · `4` usage.

`bench` measures latency/throughput only; it does **not** validate tool structured output against `outputSchema` (use `inspect`/`check` for schema validity).

**Bench mechanics**
- Timing: `process.hrtime.bigint()` around each op; never `Date.now()`; no `console.log` inside the timed region.
- Percentiles via nearest-rank on sorted warm samples: `pct(q) = arr[min(len-1, ceil(q/100*len)-1)]`.
- **Tool error semantics:** `callTool` tool-level errors return `{ isError:true }` (timed, counted as error). Transport/timeout failures reject (error sample, no latency). `errorRate = errors / completed`.
- Concurrency (closed): worker pool keeps N in flight. RPS (open): scheduled dispatch at R req/s. Throughput reported separately from latency.

### 4.4 `call` — one-off invocation
Invoke one tool once; print the structured result + round-trip timing.

Flags: `--tool <name>` (required), `--args <json>`, `--raw` (only result content), `--expect-error` (exit 0 only if the call errors), `--json`.

**Exit:** `0` success (or `--expect-error` & it errored) · `5` MCP tool error without `--expect-error` · `3` connect fail · `4` usage.

### 4.5 `check` — THE CI gate
Load an assertions file (auto-discover `mcp-vitals.{yaml,yml,json}` in cwd, or `-c`) describing expected capabilities, schema validity, and latency SLAs. Connect once, run required benches, evaluate every assertion, print a pass/fail table, exit non-zero on failure.

Flags: `-c, --config <path>`, `--junit <path|->`, `--json`, `--only <glob>` / `--skip <glob>`, `--iterations/--warmup/--concurrency` (global overrides), `--bail`, `--no-latency` (presence+schema only). `--json` and `--junit -` both write stdout and cannot be combined (exit 4).

**Exit:** `0` all passed · `2` ≥1 assertion failed · `3` connect fail · `6` config missing/unparseable/schema-invalid · `4` usage.

---

## 5. Output formats

- **pretty** (default): human TTY — header blocks, aligned tables, ANSI via `picocolors` (auto-off when not TTY / `NO_COLOR` / `--no-color`). Human output → stdout; progress → stderr.
- **`--json`**: a single self-contained JSON object per invocation on stdout (NOT NDJSON), carrying `ok: boolean`. Human output pushed to stderr. Guarantees `mcp-vitals ... --json | jq`.
- **`--junit <path|->`** (`check`): JUnit XML, one `<testcase>` per assertion.
- **`--raw`** (`call`): just the tool result content.
- **Input symmetry:** `--args` accepts inline JSON, `-` (stdin), or `@file.json`.

---

## 6. Exit-code policy (stable API)

| Code | Class | Meaning |
|---|---|---|
| `0` | success | all assertions passed / op succeeded |
| `2` | **health / assertion** | server reached but unhealthy: `--fail-on`/`check` failed, SLA exceeded, a tool errored during `bench`, or an invalid inputSchema. **The canonical "red build" code.** |
| `3` | **connection** | could not connect, handshake/initialize failed, or connect timed out (infra) |
| `4` | usage | bad/conflicting flags, malformed `--args` JSON |
| `5` | tool-error | single `call` returned `isError:true` without `--expect-error` |
| `6` | config | `check` assertions file missing, unparseable, or schema-invalid |

A pipeline branches on the class — `2` investigate the server, `3` retry/infra, `4`/`6` fix the invocation/config.

---

## 7. CI assertions file format (`mcp-vitals.yaml`)

Auto-discovered as `mcp-vitals.{yaml,yml,json}` in cwd (YAML or JSON; same shape). Validated against a bundled JSON Schema before use; a violation → exit `6`.

```yaml
# mcp-vitals.yaml — committed next to your MCP server
$schema: https://unpkg.com/mcp-vitals/schema/assertions.schema.json

server:
  command: node
  args: ["dist/server.js"]
  env:
    NODE_ENV: test
  # url: http://localhost:3000/mcp
  # headers: { Authorization: "Bearer ${MCP_TOKEN}" }   # ${VAR} expands from process.env
  transport: stdio
  connectTimeoutMs: 8000

defaults:
  iterations: 100
  warmup: 3
  concurrency: 1
  timeoutMs: 10000

expect:
  tools:    [search, fetch-url, calculate-bmi]
  resources: []
  prompts:  []
  schemasValid: true

latency:
  - id: search-fast
    tool: search
    args: { query: "ping" }
    p50: 80ms          # bare numbers are ms; '200ms' / '1.5s' also accepted
    p95: 200ms
    p99: 500ms
    errorRate: 0       # max allowed; 0 = no tool errors permitted

  - id: bmi-warm
    tool: calculate-bmi
    args: { weightKg: 70, heightM: 1.75 }
    p95: 50ms
    iterations: 200    # per-assertion override of defaults

  - id: handshake
    probe: listTools   # no-arg protocol op instead of a tool
    p95: 100ms
```

**Assertion semantics**
- **presence:** each name in `expect.tools/resources/prompts` must appear in the (paginated) listing.
- **schema:** when `expect.schemasValid: true`, every expected tool's `inputSchema` is Ajv-validated.
- **latency:** each `latency[]` entry runs a bench (merged defaults → per-assertion → CLI overrides), then evaluates each declared threshold (`p50/p90/p95/p99/max/mean/errorRate`) as one row. `--no-latency` skips this suite (rows SKIP).
- `${VAR}` expansion in `env`/`headers`/`args` string values from `process.env`.
- Threshold parsing: bare number = ms; suffixes `ms`/`s`; `errorRate` is a fraction `0..1`.

---

## 8. Test plan (fixture in-process MCP server)

A real `McpServer` over `InMemoryTransport` gives deterministic, key-free, network-free tests. The same server is also launchable over stdio for E2E.

**Fixture server** (`tests/fixtures/fixture-server.ts`):
- `echo` — returns its `text` arg (fast deterministic baseline).
- `slow` — `await delay(ms)` from a `delayMs` arg (latency-threshold pass/fail).
- `boom` — returns `{ isError: true }` (error-rate + `call` exit-5 + `--expect-error`).
- `bad-schema` — deliberately invalid `inputSchema` (schema-validity exit-2).
- `bmi` — `outputSchema` + `structuredContent` (structured-result rendering).

**Test layers**
1. **Unit:** `stats` percentiles, `thresholds` parsing/eval, `loader` (YAML+JSON, `${VAR}`, schema-invalid → ConfigError), `args` resolution, `junit` XML shape.
2. **Integration:** in-memory client+server — connect → capability gate → paginated list → `callTool`; bench engine (cold-start, warmup exclusion, concurrency, RPS, error sampling).
3. **E2E CLI:** spawn built `bin/mcp-vitals.js` with the stdio fixture — assert exit codes per command×scenario, `--json` single-object validity, stderr discipline.

**Tooling:** `vitest`, `execa` (spawn), `tsx` (run TS fixtures). Tests gate on **relative** ordering (echo p95 < slow p95), not absolute ms, to avoid CI flakiness.

**CI:** Node 20 & 22 → `npm ci` → lint → typecheck → build → test → dogfood (`check` + `bench` against the fixture, upload JUnit artifact).

---

## 9. Risks & mitigations

- **Timing flakiness on noisy CI runners** → always warmup; the tool's own tests gate on relative ordering; expose `stddev`.
- **SDK pre-stable churn** → pin `^1.29`, import only `@modelcontextprotocol/sdk/*` subpaths with `.js`, isolate all SDK touchpoints in `transport.ts` + `mcpClient.ts`.
- **callTool tool-errors are returned, not thrown** → engine classifies tool-error vs transport-error explicitly.
- **Server stderr / stray stdout corrupting `--json`** → stdio transport `stderr:'pipe'`, all human/progress output to stderr, tested that `--json` stdout parses as exactly one object.
- **Open-model `--rps` overload / head-of-line queueing** → default concurrency 1, throughput reported separately from latency.
