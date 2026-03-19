import { useState, useEffect, useCallback } from 'react';
import { getClientAIConfig, setClientAIConfig, testClientAIConnection, fetchAvailableModels, type ClientAIConfig } from '../../services/clientAI';

export function ClientAISettings() {
  const [config, setConfig] = useState<ClientAIConfig>({ apiEndpoint: '', apiKey: '', model: '' });
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  useEffect(() => {
    const saved = getClientAIConfig();
    if (saved) setConfig(saved);
  }, []);

  const handleSave = useCallback(() => {
    setClientAIConfig(config);
    setDirty(false);
  }, [config]);

  const updateField = useCallback((field: keyof ClientAIConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setDirty(true);
    setTestResult(null);
  }, []);

  const handleTest = useCallback(async () => {
    if (!config.apiEndpoint || !config.apiKey) {
      setTestResult({ ok: false, message: 'Please fill in API Endpoint and API Key first.' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    setAvailableModels([]);

    const result = await testClientAIConnection(config, config.model || undefined);

    if (result.ok) {
      setTestResult({ ok: true, message: 'Connection successful!' });

      // Auto-fetch models
      setLoadingModels(true);
      const models = await fetchAvailableModels(config);
      setAvailableModels(models);
      setLoadingModels(false);
    } else {
      setTestResult({ ok: false, message: result.error || 'Connection failed.' });
    }

    setTesting(false);
  }, [config]);

  const filteredModels = config.model
    ? availableModels.filter(m => m.toLowerCase().includes(config.model.toLowerCase()))
    : availableModels;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Agent AI</h3>
        <p className="text-xs text-muted-foreground">
          Configure the OpenAI-compatible API for the Meta-Agent side panel.
        </p>
      </div>

      <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">API Endpoint</label>
          <input
            type="text"
            value={config.apiEndpoint}
            onChange={(e) => updateField('apiEndpoint', e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50 focus:shadow-apple-sm transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => updateField('apiKey', e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50 focus:shadow-apple-sm transition-colors"
          />
        </div>
        <div className="relative">
          <label className="text-xs text-muted-foreground block mb-1">
            Model
            {loadingModels && <span className="ml-2 text-primary">Loading models...</span>}
          </label>
          <input
            type="text"
            value={config.model}
            onChange={(e) => {
              updateField('model', e.target.value);
              setShowModelDropdown(true);
            }}
            onFocus={() => { if (availableModels.length > 0) setShowModelDropdown(true); }}
            onBlur={() => { setTimeout(() => setShowModelDropdown(false), 150); }}
            placeholder={availableModels.length > 0 ? 'Type or select a model...' : 'gpt-4o'}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm focus:outline-none focus:border-primary/50 focus:shadow-apple-sm transition-colors"
          />
          {showModelDropdown && filteredModels.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in">
              {filteredModels.map(model => (
                <button
                  key={model}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    updateField('model', model);
                    setShowModelDropdown(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-secondary/80 truncate"
                >
                  {model}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`px-3 py-2 rounded-lg text-sm ${testResult.ok ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
          {testResult.message}
          {testResult.ok && availableModels.length > 0 && (
            <span className="ml-2 text-muted-foreground">({availableModels.length} models available)</span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !config.apiEndpoint || !config.apiKey}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary disabled:opacity-50 font-medium transition-colors"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {dirty && (
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-apple-sm transition-colors"
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
