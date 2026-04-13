import type { StructuredResultRegistry } from './schema-registry.js';
import type {
  FinalizationExecutorResult,
  StructuredResultRunContext,
  StructuredResultSubmission,
  ToolDefinition,
} from './types.js';
import { validateStructuredResultSubmission } from './validator.js';

export const SUBMIT_STRUCTURED_RESULT_TOOL_NAME = 'submit_structured_result';

export function createSubmitStructuredResultTool(): ToolDefinition {
  return {
    name: SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
    description: 'Submit the final structured result for the current task.',
    inputSchema: {
      type: 'object',
      properties: {
        result_type: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['result_type', 'payload'],
      additionalProperties: false,
    },
  };
}

export function executeSubmitStructuredResult<T>(
  registry: StructuredResultRegistry,
  runContext: StructuredResultRunContext<T>,
  call: StructuredResultSubmission,
): FinalizationExecutorResult {
  const validation = validateStructuredResultSubmission<T>(registry, call);
  if (!validation.accepted) {
    runContext.validationFailures += 1;
    return {
      finalized: false,
      toolResult: {
        isError: true,
        content: validation.message,
      },
    };
  }

  runContext.acceptedResult = {
    resultType: validation.resultType,
    payload: validation.payload,
  };
  runContext.finalized = true;
  return {
    finalized: true,
    toolResult: {
      isError: false,
      content: `Accepted structured result for ${validation.resultType}`,
    },
  };
}
