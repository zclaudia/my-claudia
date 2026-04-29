/**
 * MCP Server Settings Component
 *
 * Manages MCP server configurations: list, add, edit, delete, toggle, import.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import type { McpServerConfig } from '@my-claudia/shared';

const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'kimi', label: 'Kimi' },
];

export function McpServerSettings({ readOnly = false }: { readOnly?: boolean }) {
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
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        <span className="ml-2 text-muted-foreground">Loading MCP servers...</span>
      </div>
    );
  }

  const renderForm = () => (
    <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Name *</label>
          <input
            type="text"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="e.g. filesystem"
            className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Command *</label>
          <input
            type="text"
            value={formCommand}
            onChange={e => setFormCommand(e.target.value)}
            placeholder="e.g. npx"
            className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
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
          className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Description</label>
        <input
          type="text"
          value={formDescription}
          onChange={e => setFormDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Env vars */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Environment Variables</label>
          <button
            type="button"
            onClick={() => setFormEnvPairs([...formEnvPairs, { key: '', value: '' }])}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
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
              className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
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
              className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={() => setFormEnvPairs(formEnvPairs.filter((_, j) => j !== i))}
              className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
              aria-label="Remove environment variable"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
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
              className={`px-2 py-0.5 text-xs rounded-lg border transition-colors ${
                formScope.includes(opt.value)
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-secondary/50 border-border text-muted-foreground hover:border-primary/50'
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
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          {editingId ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Search + actions */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search MCP servers..."
            className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {!readOnly && (
        <>
        <button
          type="button"
          onClick={handleImport}
          className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground whitespace-nowrap transition-colors"
          title="Import from ~/.claude/mcp.json"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => { setShowAddForm(true); setEditingId(null); resetForm(); }}
          className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 whitespace-nowrap transition-colors"
        >
          + Add
        </button>
        </>
        )}
      </div>

      {/* Import result */}
      {importResult && (
        <div className="text-xs px-3 py-2 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
          {importResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-foreground">{servers.length}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-green-400">{enabledCount}</div>
          <div className="text-xs text-muted-foreground">Enabled</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-muted-foreground">{disabledCount}</div>
          <div className="text-xs text-muted-foreground">Disabled</div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Add form */}
      {!readOnly && showAddForm && !editingId && renderForm()}

      {/* Server list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
          <p className="text-muted-foreground text-sm">
            {servers.length === 0
              ? 'No MCP servers configured'
              : 'No servers match your search'}
          </p>
          {servers.length === 0 && (
            <p className="text-muted-foreground/70 text-xs mt-1">
              Add a server or import from Claude config
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(server => (
            <div key={server.id}>
              {!readOnly && editingId === server.id ? (
                renderForm()
              ) : (
                <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors flex items-start gap-3">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{server.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        server.enabled
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-500'
                      }`}>
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {server.source === 'imported' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400">
                          Imported
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                      {server.command}{server.args?.length ? ` ${server.args.join(' ')}` : ''}
                    </p>
                    {server.description && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{server.description}</p>
                    )}
                    {server.providerScope && server.providerScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {server.providerScope.map(p => (
                          <span key={p} className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-mono">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggle(server.id)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        server.enabled ? 'bg-primary' : 'bg-secondary'
                      }`}
                      title={server.enabled ? 'Disable' : 'Enable'}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        server.enabled ? 'left-5' : 'left-0.5'
                      }`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(server)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(server.id, server.name)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
