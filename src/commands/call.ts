import type { CommonOpts } from '../context.js';
import { buildContext, buildSpec } from '../context.js';
import { Connection } from '../mcpClient.js';
import { resolveArgs } from '../args.js';
import { AssertionFailure, ToolErrorExit, UsageError } from '../errors.js';
import { makeColors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { formatMs } from '../renderers/table.js';
import { writeOut } from '../output.js';
import { Progress } from '../renderers/progress.js';

export interface CallOpts extends CommonOpts {
  tool?: string;
  args?: string;
  raw?: boolean;
  expectError?: boolean;
}

interface ContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string };
}

function renderContentText(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text') parts.push(block.text ?? '');
    else if (block.type === 'image') parts.push(`[image ${block.mimeType ?? '?'} ${sizeOf(block.data)}]`);
    else if (block.type === 'audio') parts.push(`[audio ${block.mimeType ?? '?'} ${sizeOf(block.data)}]`);
    else if (block.type === 'resource') parts.push(`[resource ${block.resource?.uri ?? '?'}]`);
    else parts.push(`[${block.type ?? 'unknown'}]`);
  }
  return parts.join('\n');
}

function sizeOf(data: string | undefined): string {
  if (!data) return '0 B';
  const bytes = Math.floor((data.length * 3) / 4);
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

export async function runCall(server: string[], opts: CallOpts): Promise<number> {
  if (!opts.tool) throw new UsageError('--tool <name> is required');
  const ctx = buildContext(opts);
  const spec = buildSpec(opts, server);
  const c = makeColors(ctx.color);
  const progress = new Progress({ quiet: ctx.quiet, json: ctx.json });
  const args = await resolveArgs(opts.args);

  progress.note(c.dim('connecting…'));
  const conn = await Connection.connect(spec);
  const t0 = process.hrtime.bigint();
  const result = await conn.callTool(opts.tool, args);
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  await conn.close();

  const text = renderContentText(result.content);

  if (ctx.json) {
    emitJson({
      ok: opts.expectError ? result.isError : !result.isError,
      tool: opts.tool,
      args,
      durationMs,
      isError: result.isError,
      content: result.content,
      structuredContent: result.structuredContent,
    });
  } else if (opts.raw) {
    writeOut(text);
  } else {
    if (result.isError) {
      writeOut(c.red(text));
    } else {
      writeOut(text);
      if (result.structuredContent !== undefined) {
        writeOut('');
        writeOut(c.dim('structured:') + ' ' + JSON.stringify(result.structuredContent));
      }
    }
    progress.note(c.dim(`done in ${formatMs(durationMs)}`));
  }

  if (opts.expectError) {
    if (!result.isError) {
      throw new AssertionFailure(`expected tool "${opts.tool}" to error, but it succeeded`);
    }
    return 0;
  }
  if (result.isError) {
    throw new ToolErrorExit(`tool "${opts.tool}" returned an error`);
  }
  return 0;
}
