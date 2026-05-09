import type { ProviderConfig } from '@my-claudia/shared';
import { Select } from '../../../components/ui/Select';

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
          <Select<BaselineSetupMode>
            ariaLabel="Mode"
            value={baselineMode}
            onChange={onModeChange}
            block
            size="md"
            options={[
              { value: 'template', label: 'Template Only' },
              { value: 'scan', label: 'Project Scan' },
              { value: 'ai_scan', label: 'AI Scan' },
            ]}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Language</span>
          <Select<BaselineSetupLanguage>
            ariaLabel="Language"
            value={baselineLanguage}
            onChange={onLanguageChange}
            block
            size="md"
            options={[
              { value: 'zh-CN', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">AI Provider</span>
          <Select
            ariaLabel="AI Provider"
            value={baselineProviderId}
            onChange={onProviderChange}
            disabled={baselineMode !== 'ai_scan'}
            block
            size="md"
            options={
              aiCapableProviders.length === 0
                ? [{ value: '', label: 'No supported provider' }]
                : aiCapableProviders.map((provider) => ({
                    value: provider.id,
                    label: `${provider.name} (${provider.type})`,
                  }))
            }
          />
        </label>
      </div>

      <div className="rounded-md border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
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
          className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || (baselineMode === 'ai_scan' && !baselineProviderId && aiCapableProviders.length > 0)}
          className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {baselineReady ? 'Regenerate Baseline' : 'Generate Baseline'}
        </button>
      </div>
    </div>
  );
}
