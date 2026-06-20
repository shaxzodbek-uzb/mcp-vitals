# Contributing to mcp-vitals

Thanks for your interest! Issues, ideas, and PRs are all welcome.

## Development setup

```bash
git clone https://github.com/shaxzodbek-uzb/mcp-vitals.git
cd mcp-vitals
npm install
```

Requires Node.js ≥ 20.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compile `src/` → `dist/` (TypeScript, ESM). |
| `npm run typecheck` | Type-check `src/` **and** `tests/` without emitting. |
| `npm run lint` | ESLint (typescript-eslint). |
| `npm test` | Build, then run the full Vitest suite. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run coverage` | Tests with V8 coverage. |
| `npm run dev -- <args>` | Run the CLI from source via tsx, e.g. `npm run dev -- inspect npx your-server`. |

## Project layout

```
src/
  cli.ts            commander wiring + error→exit-code mapping
  context.ts        global flags → TransportSpec / RunContext
  transport.ts      stdio / http / sse transport factory
  mcpClient.ts      thin wrapper over the MCP SDK Client (isolates all SDK use)
  bench/engine.ts   the benchmark loop (warmup, concurrency, rps, timing)
  commands/         inspect · ping · bench · call · check
  assertions/       mcp-vitals.yaml schema, loader, and runner
  renderers/        tables, json, junit, colors, progress
  stats.ts          percentiles / stddev
  thresholds.ts     SLA expression parsing + evaluation
tests/
  unit/             pure-function tests
  integration/      in-memory MCP client+server (no network)
  e2e/              spawn the built CLI against the stdio fixture
  fixtures/         fixture-server.ts (echo/slow/boom/bad-schema/bmi)
```

All MCP SDK usage is funneled through `src/transport.ts` and `src/mcpClient.ts`,
so an SDK upgrade is a one- or two-file change.

## Tests

The fixture server (`tests/fixtures/fixture-server.ts`) runs both in-process
(over `InMemoryTransport`, for integration tests) and over stdio (for E2E).
Latency-sensitive tests gate on **relative** ordering (e.g. `slow` p95 > `echo`
p95), never absolute milliseconds, to stay stable on shared CI runners. Please
keep new timing tests relative too.

## The assertions JSON Schema

`src/assertions/schema.ts` is the source of truth. `schema/assertions.schema.json`
is a generated copy that ships for editor IntelliSense — regenerate it after
changing the schema:

```bash
npx tsx -e "import {writeFileSync} from 'node:fs'; import {ASSERTIONS_SCHEMA} from './src/assertions/schema.js'; writeFileSync('schema/assertions.schema.json', JSON.stringify(ASSERTIONS_SCHEMA, null, 2) + '\n')"
```

## Code style

- TypeScript, ESM, `strict` mode. Keep the runtime dependency set small.
- Conventional Commits for PR titles (`feat:`, `fix:`, `docs:`, …).
- Human/result output goes to **stdout**; progress and logs go to **stderr** —
  never break `--json` purity.

## A note on `npm audit`

The dev-dependency chain (vitest → vite → esbuild) currently surfaces a
moderate **dev-server-only** esbuild advisory. It does not affect the published
package — `mcp-vitals` ships only `dist/`, `bin/`, and `schema/` (see the
`files` allowlist in `package.json`), none of which include esbuild/vite/vitest.

## License

By contributing you agree that your contributions are licensed under the MIT License.
