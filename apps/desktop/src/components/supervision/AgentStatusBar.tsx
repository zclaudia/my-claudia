import { useState } from 'react';
import { Play, Pause, Archive } from 'lucide-react';
import type { ProjectAgent, SupervisorConfig, TrustLevel } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';

interface AgentStatusBarProps {
  projectId: string;
  agent: ProjectAgent | null;
}

const phaseConfig: Record<string, { label: string; color: string }> = {
  initializing: { label: 'Initializing', color: 'bg-blue-500/10 text-blue-500' },
  setup: { label: 'Setup', color: 'bg-yellow-500/10 text-yellow-500' },
  active: { label: 'Active', color: 'bg-green-500/10 text-green-500' },
  paused: { label: 'Paused', color: 'bg-orange-500/10 text-orange-500' },
  idle: { label: 'Idle', color: 'bg-gray-500/10 text-gray-400' },
  archived: { label: 'Archived', color: 'bg-gray-600/10 text-gray-500' },
};

export function AgentStatusBar({ projectId, agent }: AgentStatusBarProps) {
  const [loading, setLoading] = useState(false);
  const [showInitForm, setShowInitForm] = useState(false);
  const [initConfig, setInitConfig] = useState<Partial<SupervisorConfig>>({
    maxConcurrentTasks: 2,
    trustLevel: 'medium',
    autoDiscoverTasks: false,
  });

  const setAgent = useSupervisionStore((s) => s.setAgent);

  const handleInit = async () => {
    setLoading(true);
    try {
      const result = await api.initSupervisionAgent(projectId, initConfig as SupervisorConfig);
      setAgent(projectId, result);
      setShowInitForm(false);
    } catch (err) {
      console.error('Failed to init agent:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: 'pause' | 'resume' | 'archive' | 'approve_setup') => {
    setLoading(true);
    try {
      const result = await api.updateSupervisionAgentAction(projectId, action);
      setAgent(projectId, result);
    } catch (err) {
      console.error(`Failed to ${action} agent:`, err);
    } finally {
      setLoading(false);
    }
  };

  // No agent: show init CTA
  if (!agent) {
    if (!showInitForm) {
      return (
        <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <span className="text-sm text-muted-foreground">No supervision agent configured</span>
          <button
            onClick={() => setShowInitForm(true)}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded"
          >
            Initialize Agent
          </button>
        </div>
      );
    }

    return (
      <div className="px-4 py-3 bg-card border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Configure Supervision Agent</h3>
          <button
            onClick={() => setShowInitForm(false)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max Concurrent Tasks</label>
            <input
              type="number"
              value={initConfig.maxConcurrentTasks ?? 2}
              onChange={(e) => setInitConfig((c) => ({ ...c, maxConcurrentTasks: parseInt(e.target.value) || 1 }))}
              min={1}
              max={5}
              className="w-full px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Trust Level</label>
            <select
              value={initConfig.trustLevel ?? 'medium'}
              onChange={(e) => setInitConfig((c) => ({ ...c, trustLevel: e.target.value as TrustLevel }))}
              className="w-full px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={initConfig.autoDiscoverTasks ?? false}
                onChange={(e) => setInitConfig((c) => ({ ...c, autoDiscoverTasks: e.target.checked }))}
                className="rounded"
              />
              Auto-discover
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowInitForm(false)}
            className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleInit}
            disabled={loading}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
          >
            {loading ? 'Initializing...' : 'Initialize'}
          </button>
        </div>
      </div>
    );
  }

  const phase = phaseConfig[agent.phase] ?? { label: agent.phase, color: 'bg-gray-500/10 text-gray-400' };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
      <div className="flex items-center gap-3">
        {/* Phase badge */}
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${phase.color}`}>
          {phase.label}
        </span>

        {/* Config summary */}
        <span className="text-xs text-muted-foreground">
          {agent.config.maxConcurrentTasks} concurrent | Trust: {agent.config.trustLevel}
        </span>

        {/* Paused reason */}
        {agent.phase === 'paused' && agent.pausedReason && (
          <span className="text-xs text-orange-500">
            ({agent.pausedReason === 'budget' ? 'Budget limit' : agent.pausedReason === 'sync_error' ? 'Sync error' : 'User paused'})
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {agent.phase === 'setup' && (
          <button
            onClick={() => handleAction('approve_setup')}
            disabled={loading}
            className="p-1.5 rounded hover:bg-secondary text-green-500 hover:text-green-400 disabled:opacity-50"
            title="Approve setup"
          >
            <Play size={14} />
          </button>
        )}
        {(agent.phase === 'active' || agent.phase === 'idle') && (
          <button
            onClick={() => handleAction('pause')}
            disabled={loading}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Pause"
          >
            <Pause size={14} />
          </button>
        )}
        {agent.phase === 'paused' && (
          <button
            onClick={() => handleAction('resume')}
            disabled={loading}
            className="p-1.5 rounded hover:bg-secondary text-green-500 hover:text-green-400 disabled:opacity-50"
            title="Resume"
          >
            <Play size={14} />
          </button>
        )}
        {agent.phase !== 'archived' && (
          <button
            onClick={() => handleAction('archive')}
            disabled={loading}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Archive"
          >
            <Archive size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
