import type { ErrorObject } from 'ajv';
import * as ajv2020 from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import type { SchemaError } from './types.js';

type ValidateFn = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
interface AjvLike {
  compile(schema: object): ValidateFn;
}

// ajv + ajv-formats are CJS with `export default`; under NodeNext the default
// can land on `.default` or on the namespace itself. Tolerate both, and type
// structurally against the small surface we use (avoids ajv's class/namespace merge).
const Ajv2020 = ((ajv2020 as { default?: unknown }).default ?? ajv2020) as {
  new (opts?: Record<string, unknown>): AjvLike;
};
const addFormats = ((ajvFormats as { default?: unknown }).default ?? ajvFormats) as (
  ajv: AjvLike,
) => AjvLike;

function makeAjv(): AjvLike {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  return ajv;
}

function formatErrors(errors: ErrorObject[] | null | undefined): SchemaError[] {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath || e.schemaPath || '/',
    message: e.message ?? 'invalid',
  }));
}

export interface SchemaCheck {
  valid: boolean;
  errors: SchemaError[];
}

/**
 * Validate that `schema` is itself a compilable JSON Schema (draft 2020-12).
 * A tool's inputSchema is "valid" iff Ajv can compile it.
 */
export function validateJsonSchema(schema: unknown): SchemaCheck {
  if (schema === null || typeof schema !== 'object') {
    return { valid: false, errors: [{ path: '/', message: 'schema is not an object' }] };
  }
  const ajv = makeAjv();
  try {
    ajv.compile(schema as object);
    return { valid: true, errors: [] };
  } catch (err) {
    return {
      valid: false,
      errors: [{ path: '/', message: (err as Error).message.split('\n')[0] ?? 'invalid schema' }],
    };
  }
}

/** Validate `data` against a (trusted) JSON Schema. Used for the assertions config. */
export function validateData(schema: object, data: unknown): SchemaCheck {
  const ajv = makeAjv();
  const validate = ajv.compile(schema);
  const ok = validate(data);
  return { valid: ok as boolean, errors: ok ? [] : formatErrors(validate.errors) };
}
