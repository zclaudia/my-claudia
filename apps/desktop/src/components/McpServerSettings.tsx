/**
 * MCP Server Settings Component
 *
 * Manages MCP server configurations: list, add, edit, delete, toggle, import.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMcpServerStore } from '../stores/mcpServerStore';
import type { McpServerConfig } from '@my-claudia/shared';

const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'kimi', label: 'Kimi' },
];

export function McpServerSettings() {
  const {
    servers,
    isLoading,
    error,
    fetchServers,
    addServer,
    editServer,
    removeServer,
    toggle,
    importFromClaude,
  } = useMcpServerStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formEnvPairs, setFormEnvPairs] = useState<{ key: string; value: string }[]>([]);
  const [formDescription, setFormDescription] = useState('');
  const [formScope, setFormScope] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormCommand('');
    setFormArgs('');
    setFormEnvPairs([]);
    setFormDescription('');
    setFormScope([]);
    setFormError(null);
  }, []);

  const openEditForm = useCallback((server: McpServerConfig) => {
    setEditingId(server.id);
    setShowAddForm(false);
    setFormName(server.name);
    setFormCommand(server.command);
    setFormArgs(server.args?.join(' ') || '');
    setFormEnvPairs(
      server.env
        ? Object.entries(server.env).map(([key, value]) => ({ key, value }))
        : []
    );
    setFormDescription(server.description || '');
    setFormScope(server.providerScope || []);
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formName.trim() || !formCommand.trim()) {
      setFormError('Name and command are required');
      return;
    }

    const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : undefined;
    const env = formEnvPairs.filter(p => p.key.trim()).length > 0
      ? Object.fromEntries(formEnvPairs.filter(p => p.key.trim()).map(p => [p.key, p.value]))
      : undefined;

    try {
      if (editingId) {
        await editServer(editingId, {
          name: formName.trim(),
          command: formCommand.trim(),
          args: args || [],
          env: env || {},
          description: formDescription.trim() || undefined,
          providerScope: formScope.length > 0 ? formScope : undefined,
        });
        setEditingId(null);
      } else {
        await addServer({
          name: formName.trim(),
          command: formCommand.trim(),
          args,
          env,
          description: formDescription.trim() || undefined,
          providerScope: formScope.length > 0 ? formScope : undefined,
        });
        setShowAddForm(false);
      }
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }, [formName, formCommand, formArgs, formEnvPairs, formDescription, formScope, editingId, addServer, editServer, resetForm]);

  const handleImport = useCallback(async () => {
    try {
      const result = await importFromClaude();
      const parts = [];
      if (result.imported.length > 0) parts.push(`Imported ${result.imported.length} server(s)`);
      if (result.skipped.length > 0) parts.push(`Skipped ${result.skipped.length} (already exist)`);
      setImportResult(parts.join('. ') || 'No servers found in ~/.claude/mcp.json');
      setTimeout(() => setImportResult(null), 5000);
    } catch (err) {
      setImportResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [importFromClaude]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await removeServer(id);
    } catch (err) {
      console.error('Failed to delete MCP server:', err);
    }
  }, [removeServer]);

  const toggleScope = useCallback((provider: string) => {
    setFormScope(prev =>
      prev.includes(provider) ? prev.filter(p => p !== provider) : [...prev, provider]
    );
  }, []);

  // Filter
  const filtered = servers.filter(s =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.command.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledCount = servers.filter(s => s.enabled).length;
  const disabledCount = servers.length - enabledCount;

  if (isLoading && servers.length === 0) {
    return <div className="text-sm text-muted-foreground">Loading MCP servers...</div>;
  }

  const renderForm = () => (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Name *</label>
          <input
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="e.g. filesystem"
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Command *</label>
          <input
            type="text"
            value={formCommand}
            onChange={e => setFormCommand(e.target.value)}
            placeholder="e.g. npx"
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Arguments (space-separated)</label>
        <input
          type="text"
          value={formArgs}
          onChange={e => setFormArgs(e.target.value)}
          placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path/to/dir"
          className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary font-mono"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Description</label>
        <input
          type="text"
          value={formDescription}
          onChange={e => setFormDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Env vars */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Environment Variables</label>
          <button
            type="button"
            onClick={() => setFormEnvPairs([...formEnvPairs, { key: '', value: '' }])}
            className="text-xs text-primary hover:underline"
          >
            + Add
          </button>
        </div>
        {formEnvPairs.map((pair, i) => (
          <div key={i} className="flex gap-2 mb-1">
            <input
              type="text"
              value={pair.key}
              onChange={e => {
                const updated = [...formEnvPairs];
                updated[i] = { ...pair, key: e.target.value };
                setFormEnvPairs(updated);
              }}
              placeholder="KEY"
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono"
            />
            <input
              type="text"
              value={pair.value}
              onChange={e => {
                const updated = [...formEnvPairs];
                updated[i] = { ...pair, value: e.target.value };
                setFormEnvPairs(updated);
              }}
              placeholder="value"
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono"
            />
            <button
              type="button"
              onClick={() => setFormEnvPairs(formEnvPairs.filter((_, j) => j !== i))}
              className="text-xs text-red-400 hover:text-red-300 px-1"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Provider scope */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Provider Scope (empty = all providers)</label>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleScope(opt.value)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                formScope.includes(opt.value)
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-background border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {formError && (
        <p className="text-xs text-red-400">{formError}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => { setShowAddForm(false); setEditingId(null); resetForm(); }}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          {editingId ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Search + actions */}
      <div className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search MCP servers..."
          className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleImport}
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-accent text-muted-foreground whitespace-nowrap"
          title="Import from ~/.claude/mcp.json"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => { setShowAddForm(true); setEditingId(null); resetForm(); }}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 whitespace-nowrap"
        >
          + Add
        </button>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="text-xs px-3 py-2 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">
          {importResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="bg-card border border-border rounded px-3 py-2">
          <span className="text-muted-foreground">Total</span>
          <span className="ml-2 font-medium">{servers.length}</span>
        </div>
        <div className="bg-card border border-border rounded px-3 py-2">
          <span className="text-green-400">Enabled</span>
          <span className="ml-2 font-medium">{enabledCount}</span>
        </div>
        <div className="bg-card border border-border rounded px-3 py-2">
          <span className="text-muted-foreground">Disabled</span>
          <span className="ml-2 font-medium">{disabledCount}</span>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 rounded px-3 py-2 border border-red-500/20">
          {error}
        </div>
      )}

      {/* Add form */}
      {showAddForm && !editingId && renderForm()}

      {/* Server list */}
      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          {servers.length === 0
            ? 'No MCP servers configured. Add one or import from Claude config.'
            : 'No servers match your search.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(server => (
            <div key={server.id}>
              {editingId === server.id ? (
                renderForm()
              ) : (
                <div className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{server.name}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        server.enabled
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-500'
                      }`}>
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {server.source === 'imported' && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/10 text-blue-400">
                          Imported
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                      {server.command}{server.args?.length ? ` ${server.args.join(' ')}` : ''}
                    </div>
                    {server.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{server.description}</div>
                    )}
                    {server.providerScope && server.providerScope.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {server.providerScope.map(p => (
                          <span key={p} className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggle(server.id)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        server.enabled ? 'bg-primary' : 'bg-gray-600'
                      }`}
                      title={server.enabled ? 'Disable' : 'Enable'}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        server.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                      }`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(server)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(server.id, server.name)}
                      className="p-1 text-muted-foreground hover:text-red-400"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
