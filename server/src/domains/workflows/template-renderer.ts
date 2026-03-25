/**
 * Workflow Template Renderer
 *
 * Renders {{mustache}}-style placeholders in workflow node config values.
 * Supported context sources:
 *   - event.*     — trigger event payload
 *   - trigger.*   — trigger metadata (type, cron, etc.)
 *   - steps.<id>.* — output from a previously completed step
 *   - workflow.*  — workflow metadata (id, name, projectId)
 */

export interface RenderContext {
  event?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  steps?: Record<string, Record<string, unknown>>;
  workflow?: Record<string, unknown>;
}

/**
 * Resolve a dot-separated path against the render context.
 * e.g. "event.payload.text" → context.event.payload.text
 */
function resolvePath(context: RenderContext, path: string): string {
  const parts = path.split('.');
  const root = parts[0];
  let value: unknown;

  switch (root) {
    case 'event':   value = context.event; break;
    case 'trigger': value = context.trigger; break;
    case 'steps':   value = context.steps; break;
    case 'workflow': value = context.workflow; break;
    default: return '';
  }

  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[parts[i]];
  }

  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const TEMPLATE_REGEX = /\{\{(\s*[\w.]+\s*)\}\}/g;

/** Render all {{path}} placeholders in a string */
export function renderTemplate(template: string, context: RenderContext): string {
  return template.replace(TEMPLATE_REGEX, (_match, rawPath: string) => {
    return resolvePath(context, rawPath.trim());
  });
}

/**
 * Deep-render all string values in a config object.
 * Non-string values are passed through unchanged.
 */
export function renderConfig(
  config: Record<string, unknown>,
  context: RenderContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = renderTemplate(value, context);
    } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = renderConfig(value as Record<string, unknown>, context);
    } else {
      result[key] = value;
    }
  }
  return result;
}
