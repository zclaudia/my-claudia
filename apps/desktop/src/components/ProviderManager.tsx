import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { ProviderConfig } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';
import { useAndroidBack } from '../hooks/useAndroidBack';

interface ProviderManagerProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;  // When true, renders without modal wrapper
}

export function ProviderManager({ isOpen, onClose, inline = false }: ProviderManagerProps) {
  const { connectionStatus } = useServerStore();
  const isConnected = connectionStatus === 'connected';

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);

  // Form state
  type ProviderType = 'claude' | 'opencode' | 'codex' | 'cursor' | 'kimi';
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ProviderType>('claude');
  const [formCliPath, setFormCliPath] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useAndroidBack(onClose, isOpen && !inline, 20);

  const loadProviders = async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      const data = await api.getProviders();
      setProviders(data);
      // Sync to global store so Sidebar's provider dropdown stays current
      useProjectStore.getState().setProviders(data);
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // For inline mode, always load when connected
    // For modal mode, only load when open and connected
    if (inline) {
      if (isConnected) {
        loadProviders();
      }
    } else {
      if (isOpen && isConnected) {
        loadProviders();
      }
    }
  }, [isOpen, isConnected, inline]);

  const resetForm = () => {
    setFormName('');
    setFormType('claude');
    setFormCliPath('');
    setFormEnv('');
    setFormIsDefault(false);
    setEditingProvider(null);
    setShowAddForm(false);
  };

  const openEditForm = (provider: ProviderConfig) => {
    setFormName(provider.name);
    setFormType(provider.type);
    setFormCliPath(provider.cliPath || '');
    setFormEnv(provider.env ? JSON.stringify(provider.env, null, 2) : '');
    setFormIsDefault(provider.isDefault || false);
    setEditingProvider(provider);
    setShowAddForm(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) return;

    setSaving(true);
    try {
      let envObj: Record<string, string> | undefined;
      if (formEnv.trim()) {
        try {
          envObj = JSON.parse(formEnv);
        } catch {
          alert('Invalid JSON in environment variables');
          setSaving(false);
          return;
        }
      }

      const data = {
        name: formName.trim(),
        type: formType,
        cliPath: formCliPath.trim() || undefined,
        env: envObj,
        isDefault: formIsDefault
      };

      if (editingProvider) {
        await api.updateProvider(editingProvider.id, data);
      } else {
        await api.createProvider(data);
      }

      await loadProviders();
      resetForm();
    } catch (error) {
      console.error('Failed to save provider:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to ${editingProvider ? 'update' : 'create'} provider: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const shouldDelete = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Are you sure you want to delete this provider?')
      : true;
    if (!shouldDelete) return;

    try {
      await api.deleteProvider(id);
      await loadProviders();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      const message = error instanceof Error ? error.message : String(error);
      alert(`Failed to delete provider: ${message}`);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultProvider(id);
      await loadProviders();
    } catch (error) {
      console.error('Failed to set default provider:', error);
    }
  };

  if (!isOpen) return null;

  // Content rendering - shared between modal and inline modes
  const content = !isConnected ? (
    <p className="text-muted-foreground text-center py-8">Connect to a server first</p>
  ) : loading ? (
    <p className="text-muted-foreground text-center py-8">Loading...</p>
  ) : showAddForm ? (
    /* Add/Edit Form */
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Name *</label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Personal Claude, My OpenCode"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <TypeSelector value={formType} onChange={setFormType} />

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">CLI Path (optional)</label>
        <input
          type="text"
          value={formCliPath}
          onChange={(e) => setFormCliPath(e.target.value)}
          placeholder={formType === 'opencode' ? '/path/to/opencode' : formType === 'codex' ? '/path/to/codex' : formType === 'cursor' ? '/path/to/cursor-agent' : formType === 'kimi' ? '/path/to/kimi' : '/path/to/claude'}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">Custom path to {formType === 'opencode' ? 'OpenCode' : formType === 'codex' ? 'Codex' : formType === 'cursor' ? 'cursor-agent' : formType === 'kimi' ? 'Kimi' : 'Claude'} CLI binary</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">Environment Variables (JSON)</label>
        <textarea
          value={formEnv}
          onChange={(e) => setFormEnv(e.target.value)}
          placeholder={formType === 'opencode'
? `{
"OPENCODE_SERVER_PASSWORD": "your-password"
}`
: formType === 'codex'
? `{
"OPENAI_API_KEY": "your-key"
}`
: formType === 'cursor'
? `{
"CURSOR_API_KEY": "optional-api-key"
}`
: formType === 'kimi'
? `{
"KIMI_API_KEY": "your-key"
}`
: `{
"ANTHROPIC_API_KEY": "your-key",
"ANTHROPIC_BASE_URL": "https://..."
}`}
          rows={5}
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Environment variables to pass to the CLI (e.g., API keys, custom settings)
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isDefault"
          checked={formIsDefault}
          onChange={(e) => setFormIsDefault(e.target.checked)}
          className="rounded border-border bg-secondary"
        />
        <label htmlFor="isDefault" className="text-sm">
          Set as default provider
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!formName.trim() || saving}
          className="flex-1 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : editingProvider ? 'Update' : 'Create'}
        </button>
        <button
          onClick={resetForm}
          className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    /* Provider List */
    <div className="space-y-2">
      {providers.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No providers configured.<br />
          Add a provider to get started.
        </p>
      ) : (
        providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg hover:bg-secondary"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{provider.name}</span>
                {provider.isDefault && (
                  <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded">
                    Default
                  </span>
                )}
                <span className="px-1.5 py-0.5 bg-secondary text-muted-foreground text-xs rounded">
                  {provider.type || 'claude'}
                </span>
              </div>
              {provider.cliPath && (
                <div className="text-xs text-muted-foreground truncate font-mono mt-1">
                  {provider.cliPath}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 ml-2">
              {!provider.isDefault && (
                <button
                  onClick={() => handleSetDefault(provider.id)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Set as default"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => openEditForm(provider)}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                title="Edit"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(provider.id)}
                className="p-1.5 rounded hover:bg-secondary text-destructive hover:text-destructive"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))
      )}

      <button
        onClick={() => setShowAddForm(true)}
        className="w-full py-2 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-muted-foreground hover:text-foreground flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Provider
      </button>
    </div>
  );

  // Inline mode - just return the content
  if (inline) {
    return content;
  }

  // Modal mode - wrap with backdrop and modal container
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[600px] md:max-h-[80vh] bg-card rounded-lg shadow-xl z-50 flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">Provider Management</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {content}
        </div>
      </div>
    </>
  );
}

const TYPE_OPTIONS: { value: 'claude' | 'opencode' | 'codex' | 'cursor' | 'kimi'; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor Agent' },
  { value: 'kimi', label: 'Kimi Code' },
];

function TypeSelector({ value, onChange }: { value: string; onChange: (v: 'claude' | 'opencode' | 'codex' | 'cursor' | 'kimi') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = TYPE_OPTIONS.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-muted-foreground mb-1">Type</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary text-left"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl animate-apple-fade-in z-50 py-1 overflow-hidden">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                opt.value === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground hover:bg-secondary/80'
              }`}
            >
              <span className="w-4 flex-shrink-0">
                {opt.value === value && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
