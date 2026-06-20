import type { CommonOpts } from '../context.js';
import { buildContext, buildSpec } from '../context.js';
import { Connection } from '../mcpClient.js';
import { computeStats } from '../stats.js';
import { makeColors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { formatMs } from '../renderers/table.js';
import { writeOut } from '../output.js';
import { Progress } from '../renderers/progress.js';

export interface PingOpts extends CommonOpts {
  count: number;
  list?: boolean;
}

export async function runPing(server: string[], opts: PingOpts): Promise<number> {
  const ctx = buildContext(opts);
  const spec = buildSpec(opts, server);
  const c = makeColors(ctx.color);
  const progress = new Progress({ quiet: ctx.quiet, json: ctx.json });

  const count = Math.max(1, opts.count);
  const handshakes: number[] = [];
  let lastListMs: number | null = null;
  let target = '';

  for (let i = 0; i < count; i++) {
    progress.status(c.dim(`ping ${i + 1}/${count}…`));
    const conn = await Connection.connect(spec);
    target = conn.target;
    handshakes.push(conn.coldStartMs);
    if (opts.list) {
      const t0 = process.hrtime.bigint();
      await conn.listTools();
      lastListMs = Number(process.hrtime.bigint() - t0) / 1e6;
    }
    await conn.close();
  }
  progress.clearStatus();

  const stats = computeStats(handshakes);

  if (ctx.json) {
    emitJson({
      ok: true,
      target,
      count,
      samples: handshakes,
      handshake: stats
        ? { min: stats.min, mean: stats.mean, p50: stats.p50, p95: stats.p95, max: stats.max }
        : null,
      listToolsMs: lastListMs,
    });
    return 0;
  }

  if (count === 1) {
    const list = lastListMs !== null ? `, tools/list ${formatMs(lastListMs)}` : '';
    writeOut(`${c.green('●')} connected to ${c.bold(target)} in ${c.bold(formatMs(handshakes[0]))}${c.dim(list)}`);
  } else if (stats) {
    writeOut(c.bold(`${count} handshakes to ${target}`));
    writeOut(
      c.dim('min/mean/p50/p95/max  ') +
        `${formatMs(stats.min)} / ${formatMs(stats.mean)} / ${formatMs(stats.p50)} / ${formatMs(stats.p95)} / ${formatMs(stats.max)}`,
    );
  }
  return 0;
}
