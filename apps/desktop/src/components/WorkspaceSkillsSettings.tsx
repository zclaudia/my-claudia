/**
 * Workspace Skills Settings Component
 *
 * Manages workspace skills and external skill directories.
 * Skills are registered as MCP bridge tools for all AI providers.
 */

import { useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';
import type { WorkspaceSkillInfo, RegisteredSkillTool } from '../services/api';

export function WorkspaceSkillsSettings({ readOnly = false }: { readOnly?: boolean }) {
  const [skills, setSkills] = useState<WorkspaceSkillInfo[]>([]);
  const [registeredTools, setRegisteredTools] = useState<RegisteredSkillTool[]>([]);
  const [externalDirs, setExternalDirs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Skill editor state
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // New skill form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newSkillId, setNewSkillId] = useState('');
  const [newSkillContent, setNewSkillContent] = useState('');

  // External dir form
  const [newDirPath, setNewDirPath] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [skillList, dirs, tools] = await Promise.all([
        api.getWorkspaceSkills(),
        api.getExternalSkillDirs(),
        api.getRegisteredSkillTools(),
      ]);
      setSkills(skillList);
      setExternalDirs(dirs);
      setRegisteredTools(tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEditSkill = useCallback(async (skillId: string) => {
    try {
      const { content } = await api.getWorkspaceSkill(skillId);
      setEditingSkillId(skillId);
      setEditContent(content);
      setShowNewForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skill');
    }
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingSkillId) return;
    setIsSaving(true);
    try {
      await api.saveWorkspaceSkill(editingSkillId, editContent);
      setEditingSkillId(null);
      setEditContent('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setIsSaving(false);
    }
  }, [editingSkillId, editContent, loadData]);

  const handleCreateSkill = useCallback(async () => {
    if (!newSkillId.trim() || !newSkillContent.trim()) return;
    setIsSaving(true);
    try {
      await api.saveWorkspaceSkill(newSkillId.trim(), newSkillContent);
      setShowNewForm(false);
      setNewSkillId('');
      setNewSkillContent('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setIsSaving(false);
    }
  }, [newSkillId, newSkillContent, loadData]);

  const handleDeleteSkill = useCallback(async (skillId: string, skillName: string) => {
    if (!confirm(`Delete skill "${skillName}"?`)) return;
    try {
      await api.deleteWorkspaceSkill(skillId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    }
  }, [loadData]);

  const handleAddDir = useCallback(async () => {
    const trimmed = newDirPath.trim();
    if (!trimmed || externalDirs.includes(trimmed)) return;
    try {
      const updated = [...externalDirs, trimmed];
      await api.saveExternalSkillDirs(updated);
      setExternalDirs(updated);
      setNewDirPath('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    }
  }, [newDirPath, externalDirs, loadData]);

  const handleRemoveDir = useCallback(async (dir: string) => {
    try {
      const updated = externalDirs.filter(d => d !== dir);
      await api.saveExternalSkillDirs(updated);
      setExternalDirs(updated);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove directory');
    }
  }, [externalDirs, loadData]);

  if (isLoading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        <span className="ml-2 text-muted-foreground">Loading skills...</span>
      </div>
    );
  }

  // Editing a skill — full-screen editor
  if (editingSkillId && !readOnly) {
    return (
      <div className="space-y-4">
        <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="font-medium text-sm">{editingSkillId}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setEditingSkillId(null); setEditContent(''); }}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-80 px-3 py-2 text-sm font-mono bg-secondary/50 border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search + actions bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search skills..."
            className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled
          />
        </div>
        {!readOnly && (
        <button
          type="button"
          onClick={() => { setShowNewForm(true); setEditingSkillId(null); }}
          className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 whitespace-nowrap transition-colors"
        >
          + Add
        </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-foreground">{registeredTools.length}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-green-400">{skills.length}</div>
          <div className="text-xs text-muted-foreground">Workspace</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-muted-foreground">{registeredTools.length - skills.length}</div>
          <div className="text-xs text-muted-foreground">External</div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-400/70 hover:text-red-400 mt-1">dismiss</button>
        </div>
      )}

      {/* New skill form */}
      {!readOnly && showNewForm && (
        <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Skill ID *</label>
            <input
              type="text"
              placeholder="e.g. my-skill"
              value={newSkillId}
              onChange={(e) => setNewSkillId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">SKILL.md Content *</label>
            <textarea
              placeholder={"---\nname: My Skill\ndescription: What this skill does\n---\n\n# My Skill\n\nInstructions here..."}
              value={newSkillContent}
              onChange={(e) => setNewSkillContent(e.target.value)}
              className="w-full h-40 px-3 py-2 text-sm font-mono bg-secondary/50 border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowNewForm(false); setNewSkillId(''); setNewSkillContent(''); }}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSkill}
              disabled={!newSkillId.trim() || !newSkillContent.trim() || isSaving}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Registered skills list */}
      {registeredTools.length === 0 && !showNewForm ? (
        <div className="text-center py-8">
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-muted-foreground text-sm">No skills configured</p>
          <p className="text-muted-foreground/70 text-xs mt-1">Add a skill or configure an external directory</p>
        </div>
      ) : (
        <div className="space-y-2">
          {registeredTools.map(tool => {
            const skillId = tool.name.replace('skill__', '');
            const isWorkspace = skills.some(s => s.id === skillId);
            const workspaceSkill = skills.find(s => s.id === skillId);
            const displayName = workspaceSkill?.name || tool.description.replace(/^\[Skill\]\s*/, '').split(':')[0] || skillId;
            const displayDesc = workspaceSkill?.description || tool.description.replace(/^\[Skill\]\s*[^:]*:\s*/, '') || '';

            return (
              <div
                key={tool.name}
                className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{displayName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400">
                      Active
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      isWorkspace ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {isWorkspace ? 'Workspace' : 'External'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{displayDesc}</p>
                  <p className="text-xs text-muted-foreground/50 font-mono mt-0.5">{tool.name}</p>
                </div>
                {!readOnly && isWorkspace && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditSkill(skillId)}
                      className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSkill(skillId, displayName)}
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
            );
          })}
        </div>
      )}

      {/* External Skill Directories */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">External Directories</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Directories with SKILL.md files are auto-discovered and registered as skill tools.
        </p>

        {externalDirs.length > 0 && (
          <div className="space-y-2">
            {externalDirs.map(dir => (
              <div
                key={dir}
                className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors flex items-center gap-3"
              >
                <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="text-sm font-mono truncate flex-1 min-w-0">{dir}</span>
                {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemoveDir(dir)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!readOnly && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="/path/to/skills/directory"
            value={newDirPath}
            onChange={(e) => setNewDirPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDir()}
            className="flex-1 px-3 py-1.5 text-sm font-mono bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={handleAddDir}
            disabled={!newDirPath.trim()}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 whitespace-nowrap transition-colors"
          >
            + Add
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
