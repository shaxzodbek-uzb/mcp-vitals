# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-20

Initial release.

### Added

- `bench` — latency-benchmark a tool or no-arg probe: warmup + N iterations (or
  `--duration`), closed-model concurrency (`-c`) or open-model arrival rate
  (`--rps`), reporting min/mean/p50/p90/p95/p99/max/stddev, cold-start,
  throughput, and error rate. Inline SLA gating via `--fail-on 'p95<200ms'`.
- `check` — run a committed `mcp-vitals.{yaml,yml,json}` assertion suite
  (capability presence, inputSchema validity, latency SLAs) with JUnit/JSON
  reporters and distinct exit codes — the CI gate.
- `inspect` — list tools/resources/prompts and validate every tool's
  `inputSchema` is valid JSON Schema.
- `call` — invoke one tool with timing, `--raw` and `--expect-error` modes.
- `ping` — handshake/initialize latency and liveness, single or distribution.
- Transports: stdio, Streamable HTTP, and SSE (with automatic HTTP→SSE
  fallback), header-based auth, and stdio env injection.
- `--json` single-object output on every command, with strict stdout/stderr
  discipline so `| jq` always works.
- Published JSON Schema for `mcp-vitals.yaml` editor IntelliSense.

[Unreleased]: https://github.com/shaxzodbek-uzb/mcp-vitals/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shaxzodbek-uzb/mcp-vitals/releases/tag/v0.1.0
