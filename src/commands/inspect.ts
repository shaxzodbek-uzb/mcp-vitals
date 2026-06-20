import type { CommonOpts } from '../context.js';
import { buildContext, buildSpec } from '../context.js';
import { Connection } from '../mcpClient.js';
import { validateJsonSchema } from '../schema.js';
import { matchesAny } from '../glob.js';
import { AssertionFailure } from '../errors.js';
import { makeColors } from '../renderers/colors.js';
import { emitJson } from '../renderers/json.js';
import { renderKeyValues, renderTable } from '../renderers/table.js';
import { writeOut } from '../output.js';
import { Progress } from '../renderers/progress.js';
import type { ToolInfo } from '../types.js';

export interface InspectOpts extends CommonOpts {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  schema?: boolean;
  validateSchemas: boolean;
  filter?: string;
}

export async function runInspect(server: string[], opts: InspectOpts): Promise<number> {
  const ctx = buildContext(opts);
  const spec = buildSpec(opts, server);
  const c = makeColors(ctx.color);
  const progress = new Progress({ quiet: ctx.quiet, json: ctx.json });

  const wantAll = !opts.tools && !opts.resources && !opts.prompts;
  const wantTools = wantAll || opts.tools === true;
  const wantResources = wantAll || opts.resources === true;
  const wantPrompts = wantAll || opts.prompts === true;
  const filter = (name: string): boolean => matchesAny(name, opts.filter ? [opts.filter] : undefined);

  progress.note(c.dim('connecting…'));
  const conn = await Connection.connect(spec);
  const identity = conn.identity();
  const caps = conn.capabilities();

  let tools: ToolInfo[] = wantTools ? await conn.listTools() : [];
  tools = tools.filter((t) => filter(t.name));
  const resources = (wantResources ? await conn.listResources() : []).filter((r) =>
    filter(r.name ?? r.uri),
  );
  const prompts = (wantPrompts ? await conn.listPrompts() : []).filter((p) => filter(p.name));

  let invalid = 0;
  if (opts.validateSchemas) {
    for (const t of tools) {
      const res = validateJsonSchema(t.inputSchema);
      t.schemaValid = res.valid;
      t.schemaErrors = res.errors;
      if (!res.valid) invalid++;
    }
  }
  await conn.close();

  const schemasValid = tools.length - invalid;
  const ok = invalid === 0;

  if (ctx.json) {
    emitJson({
      ok,
      server: identity,
      transport: conn.kind,
      capabilities: { ...caps.raw, tools: caps.tools, resources: caps.resources, prompts: caps.prompts },
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        ...(opts.schema ? { inputSchema: t.inputSchema } : {}),
        requiredArgs: t.requiredArgs,
        totalArgs: t.totalArgs,
        schemaValid: t.schemaValid,
        schemaErrors: t.schemaErrors,
      })),
      resources: resources.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType })),
      prompts: prompts.map((p) => ({ name: p.name, arguments: p.arguments })),
      summary: {
        tools: tools.length,
        resources: resources.length,
        prompts: prompts.length,
        schemasValid,
        schemasInvalid: invalid,
      },
    });
  } else {
    progress.clearStatus();
    writeOut(
      renderKeyValues(
        [
          ['Server', `${c.bold(identity.name)} ${c.dim('v' + identity.version)}`],
          ['Protocol', identity.protocolVersion ?? '—'],
          ['Transport', conn.kind],
          [
            'Capabilities',
            [
              caps.tools ? c.green('tools') : c.dim('tools'),
              caps.resources ? c.green('resources') : c.dim('resources'),
              caps.prompts ? c.green('prompts') : c.dim('prompts'),
            ].join('  '),
          ],
        ],
        c,
      ),
    );
    if (identity.instructions) {
      writeOut('');
      writeOut(c.dim(identity.instructions));
    }
    if (wantTools) {
      writeOut('');
      writeOut(c.bold(`Tools (${tools.length})`));
      if (tools.length > 0) {
        writeOut(
          renderTable(
            [
              { header: 'NAME' },
              { header: 'ARGS', align: 'right' },
              { header: 'SCHEMA' },
              { header: 'DESCRIPTION' },
            ],
            tools.map((t) => [
              t.name,
              `${t.requiredArgs}/${t.totalArgs}`,
              opts.validateSchemas ? (t.schemaValid ? c.green('ok') : c.red('invalid')) : c.dim('—'),
              truncate(t.description ?? '', 48),
            ]),
            c,
          ),
        );
      }
    }
    if (wantResources && resources.length > 0) {
      writeOut('');
      writeOut(c.bold(`Resources (${resources.length})`));
      writeOut(
        renderTable(
          [{ header: 'URI' }, { header: 'NAME' }, { header: 'TYPE' }],
          resources.map((r) => [r.uri, r.name ?? '', r.mimeType ?? '']),
          c,
        ),
      );
    }
    if (wantPrompts && prompts.length > 0) {
      writeOut('');
      writeOut(c.bold(`Prompts (${prompts.length})`));
      writeOut(
        renderTable(
          [{ header: 'NAME' }, { header: 'ARGS' }],
          prompts.map((p) => [p.name, p.arguments.map((a) => a.name).join(', ')]),
          c,
        ),
      );
    }
    writeOut('');
    const schemaNote = opts.validateSchemas
      ? `schemas: ${c.green(String(schemasValid) + ' ok')}${invalid ? ', ' + c.red(invalid + ' invalid') : ''}`
      : 'schemas: not validated';
    writeOut(
      c.dim(
        `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts — ${schemaNote}`,
      ),
    );
  }

  if (opts.validateSchemas && invalid > 0) {
    throw new AssertionFailure(`${invalid} tool inputSchema(s) are invalid`);
  }
  return 0;
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}
