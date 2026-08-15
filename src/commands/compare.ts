import { readFile } from 'node:fs/promises';
import type { CommonOpts } from '../context.js';
import { buildContext } from '../context.js';
import {
  asBenchRun,
  compareRuns,
  parseRegressionExpr,
  type BenchRun,
  type Comparison,
  type MetricDelta,
  type RegressionOutcome,
} from '../compare.js';
import { AssertionFailure, UsageError } from '../errors.js';
import { makeColors, type Colors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { formatMs, renderTable } from '../renderers/table.js';
import { writeOut } from '../output.js';

export interface CompareOpts extends CommonOpts {
  failOn: string[];
  markdown?: boolean;
}

/** Metrics worth showing by default; the rest are in --json. */
const REPORTED = ['p50', 'p90', 'p95', 'p99', 'max', 'mean'] as const;

export async function runCompare(
  files: string[],
  opts: CompareOpts,
): Promise<number> {
  const ctx = buildContext(opts);
  const c = makeColors(ctx.color && !opts.markdown);

  if (files.length === 0 || files.length > 2) {
    throw new UsageError('usage: mcp-vitals compare <baseline.json> [current.json]');
  }
  const [baselinePath, currentPath = '-'] = files;

  const baseline = asBenchRun(await readJson(baselinePath as string), baselinePath as string);
  const current = asBenchRun(await readJson(currentPath), currentPath);

  const exprs = opts.failOn.map(parseRegressionExpr);
  const comparison = compareRuns(baseline, current, exprs);

  if (ctx.json) {
    emitJson({
      ok: comparison.ok,
      baseline: { source: baselinePath, samples: baseline.warm?.count ?? 0 },
      current: { source: currentPath, samples: current.warm?.count ?? 0 },
      baselineNoisy: comparison.baselineNoisy,
      coldStart: comparison.coldStart,
      deltas: comparison.deltas,
      assertions: comparison.outcomes,
    });
  } else if (opts.markdown) {
    writeOut(renderMarkdown(comparison, baseline, current));
  } else {
    renderText(comparison, c, baselinePath as string, currentPath);
  }

  if (!comparison.ok) {
    throw new AssertionFailure('a regression gate failed');
  }
  return 0;
}

async function readJson(path: string): Promise<unknown> {
  const raw = path === '-' ? await readStdin() : await readFileText(path);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UsageError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

async function readFileText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    throw new UsageError(`could not read ${path}: ${(err as NodeJS.ErrnoException).message}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** `+12.3%` / `-4.0%` / `—`, always signed so direction is unmissable. */
function formatPctDelta(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function formatMsDelta(ms: number | null): string {
  if (ms === null) return '—';
  const sign = ms > 0 ? '+' : '';
  return `${sign}${formatMs(ms)}`;
}

function shown(comparison: Comparison): MetricDelta[] {
  return comparison.deltas.filter(
    (d) => (REPORTED as readonly string[]).includes(d.metric) && d.baseline !== null,
  );
}

function renderText(
  comparison: Comparison,
  c: Colors,
  baselinePath: string,
  currentPath: string,
): void {
  writeOut(c.dim(`baseline ${baselinePath}  →  current ${currentPath === '-' ? 'stdin' : currentPath}`));
  writeOut('');

  const rows = shown(comparison).map((d) => [
    d.metric,
    formatMs(d.baseline as number),
    d.current === null ? '—' : formatMs(d.current),
    colorDelta(formatMsDelta(d.delta), d, c),
    colorDelta(formatPctDelta(d.deltaPct), d, c),
    d.withinNoise ? c.dim('within noise') : '',
  ]);

  writeOut(
    renderTable(
      [
        { header: 'metric' },
        { header: 'baseline', align: 'right' },
        { header: 'current', align: 'right' },
        { header: 'delta', align: 'right' },
        { header: 'change', align: 'right' },
        { header: '' },
      ],
      rows,
      c,
    ),
  );

  if (comparison.coldStart) {
    const cs = comparison.coldStart;
    writeOut('');
    writeOut(
      `${c.dim('Cold start')}  ${formatMs(cs.baseline as number)} → ${formatMs(cs.current as number)}  ` +
        colorDelta(formatPctDelta(cs.deltaPct), cs, c),
    );
  }

  if (comparison.baselineNoisy) {
    writeOut('');
    writeOut(
      c.yellow('!') +
        c.dim(
          ' the baseline has fewer than 20 samples — percentiles from a run that short are' +
            ' dominated by which iterations happened to be slow. Raise -n before gating on this.',
        ),
    );
  }

  if (comparison.outcomes.length > 0) {
    writeOut('');
    for (const o of comparison.outcomes) {
      const mark = o.pass ? c.green('PASS') : c.red('FAIL');
      const actual = o.actual === null ? '—' : formatOutcome(o);
      const note = o.withinNoise ? c.dim('  (within baseline noise)') : '';
      writeOut(`  ${mark}  ${o.expr}  ${c.dim('actual ' + actual)}${note}`);
    }
  }
}

function formatOutcome(o: RegressionOutcome): string {
  return o.unit === 'percent' ? formatPctDelta(o.actual) : formatMsDelta(o.actual);
}

function colorDelta(text: string, d: MetricDelta, c: Colors): string {
  if (d.delta === null || d.withinNoise) return c.dim(text);
  if (d.delta > 0) return c.red(text);
  if (d.delta < 0) return c.green(text);
  return text;
}

/** A table that pastes straight into a PR comment. */
function renderMarkdown(comparison: Comparison, baseline: BenchRun, current: BenchRun): string {
  const lines: string[] = [];
  const name = current.target?.name ?? baseline.target?.name ?? 'server';
  const verdict = comparison.outcomes.length === 0
    ? 'report only'
    : comparison.ok
      ? '✅ no regression'
      : '❌ regression';
  lines.push(`### mcp-vitals — \`${name}\` (${verdict})`, '');
  lines.push('| metric | baseline | current | change |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const d of shown(comparison)) {
    const change = d.withinNoise
      ? `${formatPctDelta(d.deltaPct)} _(noise)_`
      : formatPctDelta(d.deltaPct);
    lines.push(
      `| ${d.metric} | ${formatMs(d.baseline as number)} | ` +
        `${d.current === null ? '—' : formatMs(d.current)} | ${change} |`,
    );
  }
  if (comparison.outcomes.length > 0) {
    lines.push('');
    for (const o of comparison.outcomes) {
      lines.push(`- ${o.pass ? '✅' : '❌'} \`${o.expr}\` — actual ${formatOutcome(o)}`);
    }
  }
  if (comparison.baselineNoisy) {
    lines.push('');
    lines.push(
      '> The baseline has fewer than 20 samples; percentiles that short are dominated by ' +
        'which iterations happened to be slow.',
    );
  }
  return lines.join('\n');
}
