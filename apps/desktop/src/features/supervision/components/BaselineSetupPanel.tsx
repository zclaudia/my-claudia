import type { ProviderConfig } from '@my-claudia/shared';

type BaselineSetupMode = 'template' | 'scan' | 'ai_scan';
type BaselineSetupLanguage = 'zh-CN' | 'en';

interface BaselineSetupPanelProps {
  loading: boolean;
  baselineReady: boolean;
  baselineMode: BaselineSetupMode;
  baselineLanguage: BaselineSetupLanguage;
  baselineProviderId: string;
  aiCapableProviders: ProviderConfig[];
  onModeChange: (mode: BaselineSetupMode) => void;
  onLanguageChange: (lang: BaselineSetupLanguage) => void;
  onProviderChange: (id: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function BaselineSetupPanel({
  loading,
  baselineReady,
  baselineMode,
  baselineLanguage,
  baselineProviderId,
  aiCapableProviders,
  onModeChange,
  onLanguageChange,
  onProviderChange,
  onCancel,
  onSubmit,
}: BaselineSetupPanelProps) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3">
      <div>
        <div className="text-xs font-medium text-foreground">Baseline Generation</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Choose how `baseline/project.md` and `baseline/architecture.md` should be created.
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Mode</span>
          <select
            aria-label="Mode"
            value={baselineMode}
            onChange={(event) => onModeChange(event.target.value as BaselineSetupMode)}
            className="rounded border border-border bg-background px-3 py-2 text-xs"
          >
            <option value="template">Template Only</option>
            <option value="scan">Project Scan</option>
            <option value="ai_scan">AI Scan</option>
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Language</span>
          <select
            aria-label="Language"
            value={baselineLanguage}
            onChange={(event) => onLanguageChange(event.target.value as BaselineSetupLanguage)}
            className="rounded border border-border bg-background px-3 py-2 text-xs"
          >
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">AI Provider</span>
          <select
            aria-label="AI Provider"
            value={baselineProviderId}
            onChange={(event) => onProviderChange(event.target.value)}
            disabled={baselineMode !== 'ai_scan'}
            className="rounded border border-border bg-background px-3 py-2 text-xs disabled:opacity-50"
          >
            {aiCapableProviders.length === 0 ? (
              <option value="">No supported provider</option>
            ) : (
              aiCapableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({provider.type})
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="rounded border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
        {baselineMode === 'template'
          ? 'Create baseline files from the default template only.'
          : baselineMode === 'scan'
            ? 'Scan the project structure and generate a first-pass baseline without using AI.'
            : 'Use the selected AI provider to turn project scan results into a richer baseline draft.'}
        {baselineReady ? ' Existing baseline files will be regenerated.' : ''}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || (baselineMode === 'ai_scan' && !baselineProviderId && aiCapableProviders.length > 0)}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {baselineReady ? 'Regenerate Baseline' : 'Generate Baseline'}
        </button>
      </div>
    </div>
  );
}
