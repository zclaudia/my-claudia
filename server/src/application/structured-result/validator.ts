import type { StructuredResultAccepted, StructuredResultRejected, StructuredResultSubmission, StructuredResultValidationResult } from './types.js';
import type { StructuredResultRegistry } from './schema-registry.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSchemaNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
): string[] {
  const errors: string[] = [];

  const expectedType = typeof schema.type === 'string' ? schema.type : undefined;
  if (expectedType === 'object') {
    if (!isPlainObject(value)) {
      return [`${path} must be an object`];
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [];

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in value)) continue;
      if (!isPlainObject(childSchema)) continue;
      errors.push(...validateSchemaNode(childSchema, value[key], `${path}.${key}`));
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }

    return errors;
  }

  if (expectedType === 'string') {
    if (typeof value !== 'string') {
      return [`${path} must be a string`];
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      return [`${path} must be one of: ${schema.enum.join(', ')}`];
    }
    return errors;
  }

  if (expectedType === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return [`${path} must be a number`];
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
    return errors;
  }

  if (expectedType === 'boolean') {
    if (typeof value !== 'boolean') {
      return [`${path} must be a boolean`];
    }
    return errors;
  }

  if (expectedType === 'array') {
    if (!Array.isArray(value)) {
      return [`${path} must be an array`];
    }
    const itemSchema = isPlainObject(schema.items) ? schema.items : undefined;
    if (itemSchema) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateSchemaNode(itemSchema, value[i], `${path}[${i}]`));
      }
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} must have at most ${schema.maxItems} items`);
    }
    return errors;
  }

  return errors;
}

export function validateStructuredResultSubmission<T>(
  registry: StructuredResultRegistry,
  submission: StructuredResultSubmission,
): StructuredResultValidationResult<T> {
  const entry = registry.get<T>(submission.resultType);
  if (!entry) {
    const message = `Unknown result_type "${submission.resultType}". Expected one of: ${registry.list().join(', ') || '(none)'}`;
    const rejected: StructuredResultRejected = {
      accepted: false,
      code: 'unknown_result_type',
      message,
    };
    return rejected;
  }

  if (!isPlainObject(submission.payload)) {
    const rejected: StructuredResultRejected = {
      accepted: false,
      code: 'invalid_payload_type',
      message: 'payload must be an object',
    };
    return rejected;
  }

  const errors = validateSchemaNode(entry.jsonSchema, submission.payload, 'payload');
  if (errors.length > 0) {
    const rejected: StructuredResultRejected = {
      accepted: false,
      code: 'schema_validation_failed',
      message: errors[0],
      details: errors,
    };
    return rejected;
  }

  const accepted: StructuredResultAccepted<T> = {
    accepted: true,
    resultType: submission.resultType,
    payload: submission.payload as T,
  };
  return accepted;
}
