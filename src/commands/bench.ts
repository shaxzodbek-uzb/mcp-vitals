import type { CommonOpts } from '../context.js';
import { buildContext, buildSpec } from '../context.js';
import { Connection } from '../mcpClient.js';
import { runBench } from '../bench/engine.js';
import { resolveArgs } from '../args.js';
import { evaluateExpr } from '../thresholds.js';
import { AssertionFailure, UsageError } from '../errors.js';
import { makeColors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { formatMs, formatPct, renderKeyValues, renderTable } from '../renderers/table.js';
import { writeOut } from '../output.js';
import { Progress } from '../renderers/progress.js';
import type { BenchConfig, ProbeOp, AssertionOutcome } from '../types.js';

export interface BenchOpts extends CommonOpts {
  tool?: string;
  probe?: string;
  args?: string;
  iterations?: number;
  warmup: number;
  concurrency: number;
  rps?: number;
  duration?: number;
  failOn: string[];
}

const PROBES: ProbeOp[] = ['listTools', 'listResources', 'listPrompts'];

export async function runBenchCommand(server: string[], opts: BenchOpts): Promise<number> {
  const ctx = buildContext(opts);
  const spec = buildSpec(opts, server);
  const c = makeColors(ctx.color);
  const progress = new Progress({ quiet: ctx.quiet, json: ctx.json });

  if (opts.tool && opts.probe) {
    throw new UsageError('pass either --tool or --probe, not both');
  }
  if (opts.iterations !== undefined && opts.duration !== undefined) {
    throw new UsageError('pass either --iterations or --duration, not both');
  }
  if (opts.probe && !PROBES.includes(opts.probe as ProbeOp)) {
    throw new UsageError(`invalid --probe "${opts.probe}" (expected ${PROBES.join(' | ')})`);
  }

  const targetKind: 'tool' | 'probe' = opts.tool ? 'tool' : 'probe';
  const targetName = opts.tool ?? opts.probe ?? 'listTools';
  const args = targetKind === 'tool' ? await resolveArgs(opts.args) : {};

  const config: BenchConfig = {
    targetKind,
    targetName,
    args,
    iterations: opts.duration !== undefined ? undefined : (opts.iterations ?? 50),
    durationMs: opts.duration,
    warmup: opts.warmup,
    concurrency: opts.concurrency,
    rps: opts.rps,
    keepAlive: true,
  };

  progress.note(c.dim('connecting…'));
  const conn = await Connection.connect(spec);
  const target = conn.target;

  const total = config.iterations;
  const result = await runBench(conn, config, spec.requestTimeoutMs, {
    onTick: (n) => {
      if (total) progress.status(c.dim(`bench ${n}/${total}…`));
      else progress.status(c.dim(`bench ${n}…`));
    },
  });
  progress.clearStatus();
  await conn.close();

  const assertions: AssertionOutcome[] = opts.failOn.map((expr) =>
    evaluateExpr(expr, result.warm, result.throughput),
  );
  const anyAssertFail = assertions.some((a) => !a.pass);
  const implicitErrorFail = opts.failOn.length === 0 && result.throughput.errors > 0;
  const failed = anyAssertFail || implicitErrorFail;

  if (ctx.json) {
    emitJson({
      ok: !failed,
      target: { kind: targetKind, name: targetName },
      transport: conn.kind,
      config: {
        iterations: config.iterations ?? null,
        durationMs: config.durationMs ?? null,
        concurrency: config.concurrency,
        rps: config.rps ?? null,
        warmup: config.warmup,
        keepAlive: config.keepAlive,
      },
      coldStartMs: result.coldStartMs,
      warm: result.warm,
      throughput: result.throughput,
      assertions: assertions.map((a) => ({ expr: a.expr, actual: a.actual, pass: a.pass })),
    });
  } else {
    const load = config.rps !== undefined ? `${config.rps} rps` : `concurrency ${config.concurrency}`;
    const size = config.durationMs !== undefined ? `${config.durationMs} ms` : `${config.iterations} iters`;
    writeOut(
      renderKeyValues(
        [
          ['Target', `${c.bold(targetName)} ${c.dim('(' + targetKind + ')')}`],
          ['Server', `${target} ${c.dim('via ' + conn.kind)}`],
          ['Load', `${size}, ${load}, warmup ${config.warmup}`],
        ],
        c,
      ),
    );
    writeOut('');
    if (result.coldStartMs !== null) {
      writeOut(`${c.dim('Cold start')}  ${c.bold(formatMs(result.coldStartMs))}`);
    }
    if (result.warm) {
      const w = result.warm;
      writeOut('');
      writeOut(
        renderTable(
          [
            { header: 'min', align: 'right' },
            { header: 'mean', align: 'right' },
            { header: 'p50', align: 'right' },
            { header: 'p90', align: 'right' },
            { header: 'p95', align: 'right' },
            { header: 'p99', align: 'right' },
            { header: 'max', align: 'right' },
            { header: 'stddev', align: 'right' },
          ],
          [[w.min, w.mean, w.p50, w.p90, w.p95, w.p99, w.max, w.stddev].map((n) => formatMs(n))],
          c,
        ),
      );
    } else {
      writeOut(c.red('no successful samples'));
    }
    const tp = result.throughput;
    writeOut('');
    const errPart =
      tp.errors > 0 ? c.red(`${tp.errors} errors (${formatPct(tp.errorRate)})`) : c.green('0 errors');
    writeOut(c.dim(`${tp.completed} completed · ${tp.rps.toFixed(1)} req/s · `) + errPart);
    if (assertions.length > 0) {
      writeOut('');
      for (const a of assertions) {
        const mark = a.pass ? c.green('PASS') : c.red('FAIL');
        writeOut(`  ${mark}  ${a.expr}  ${c.dim('actual ' + formatMetric(a))}`);
      }
    }
  }

  if (failed) {
    const reason = anyAssertFail ? 'a --fail-on assertion failed' : 'requests errored';
    throw new AssertionFailure(reason);
  }
  return 0;
}

function formatMetric(a: AssertionOutcome): string {
  if (a.actual === null) return '—';
  return a.metric === 'errorRate' ? formatPct(a.actual) : formatMs(a.actual);
}
