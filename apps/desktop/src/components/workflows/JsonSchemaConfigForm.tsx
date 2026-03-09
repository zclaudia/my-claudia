/**
 * Lightweight JSON Schema form renderer for plugin workflow step config.
 * Supports: string, number, integer, boolean, enum (select).
 */

interface JsonSchemaConfigFormProps {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

export function JsonSchemaConfigForm({ schema, config, onChange }: JsonSchemaConfigFormProps) {
  const properties = (schema.properties ?? {}) as Record<string, any>;
  const required = (schema.required ?? []) as string[];

  const updateField = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-3">
      {Object.entries(properties).map(([key, prop]) => {
        const label = prop.title ?? key;
        const description = prop.description as string | undefined;
        const isRequired = required.includes(key);
        const value = config[key];

        // Enum → select
        if (prop.enum) {
          return (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {label}{isRequired ? ' *' : ''}
              </label>
              <select
                value={(value as string) ?? prop.default ?? ''}
                onChange={(e) => updateField(key, e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
              >
                <option value="">--</option>
                {(prop.enum as string[]).map((opt: string) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
            </div>
          );
        }

        // Boolean → checkbox
        if (prop.type === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={(value as boolean) ?? prop.default ?? false}
                onChange={(e) => updateField(key, e.target.checked)}
                className="rounded border-border"
              />
              <label className="text-xs font-medium text-muted-foreground">{label}</label>
              {description && <span className="text-[10px] text-muted-foreground ml-1">({description})</span>}
            </div>
          );
        }

        // Number / Integer → number input
        if (prop.type === 'number' || prop.type === 'integer') {
          return (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {label}{isRequired ? ' *' : ''}
              </label>
              <input
                type="number"
                value={(value as number) ?? prop.default ?? ''}
                min={prop.minimum}
                max={prop.maximum}
                step={prop.type === 'integer' ? 1 : undefined}
                onChange={(e) => updateField(key, e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary"
              />
              {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
            </div>
          );
        }

        // String with format: 'textarea' or long text
        const isTextArea = prop.format === 'textarea' || (prop.maxLength && prop.maxLength > 200);
        if (isTextArea) {
          return (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {label}{isRequired ? ' *' : ''}
              </label>
              <textarea
                value={(value as string) ?? prop.default ?? ''}
                onChange={(e) => updateField(key, e.target.value)}
                placeholder={prop.placeholder ?? ''}
                rows={3}
                className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background resize-none font-mono focus:outline-none focus:border-primary"
              />
              {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
            </div>
          );
        }

        // Default: string text input
        return (
          <div key={key}>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {label}{isRequired ? ' *' : ''}
            </label>
            <input
              type={prop.format === 'password' ? 'password' : 'text'}
              value={(value as string) ?? prop.default ?? ''}
              onChange={(e) => updateField(key, e.target.value)}
              placeholder={prop.placeholder ?? ''}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary"
            />
            {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
          </div>
        );
      })}
      {Object.keys(properties).length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Use {'${stepId.output.field}'} to reference previous step outputs.
        </p>
      )}
    </div>
  );
}
