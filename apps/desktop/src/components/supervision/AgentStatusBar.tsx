import { useState, useEffect } from 'react';
import { Play, Pause, Archive } from 'lucide-react';
import type { ProjectAgent, AgentMode, SupervisorConfig, TrustLevel, ProviderConfig } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { useProjectStore } from '../../stores/projectStore';

interface AgentStatusBarProps {
  projectId: string;
  agent: ProjectAgent | null;
  /** When provided, overrides the default "Open Session" behavior (selectSession) */
  onOpenSession?: () => void;
}

const trustLevelLabels: Record<TrustLevel, { label: string; desc: string }> = {
  low: { label: 'Cautious', desc: 'Pause for approval on every result' },
  medium: { label: 'Balanced', desc: 'Auto-apply approved results' },
  high: { label: 'Autonomous', desc: 'Run independently' },
};

const phaseConfig: Record<string, { label: string; color: string }> = {
  initializing: { label: 'Initializing', color: 'bg-blue-500/10 text-blue-500' },
  setup: { label: 'Setup', color: 'bg-yellow-500/10 text-yellow-500' },
  active: { label: 'Active', color: 'bg-green-500/10 text-green-500' },
  paused: { label: 'Paused', color: 'bg-orange-500/10 text-orange-500' },
  idle: { label: 'Idle', color: 'bg-gray-500/10 text-gray-400' },
  archived: { label: 'Archived', color: 'bg-gray-600/10 text-gray-500' },
};

export function AgentStatusBar({ projectId, agent, onOpenSession }: AgentStatusBarProps) {
  const [loading, setLoading] = useState(false);
  const [showInitForm, setShowInitForm] = useState(false);
  const [initMode, setInitMode] = useState<AgentMode>('lite');
  const [initConfig, setInitConfig] = useState<Partial<SupervisorConfig>>({
    maxConcurrentTasks: 2,
    trustLevel: 'medium',
  });
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  const setAgent = useSupervisionStore((s) => s.setAgent);
  const selectSession = useProjectStore((s) => s.selectSession);

  // Load providers when init form opens
  useEffect(() => {
    if (!showInitForm) return;
    const storeProviders = useProjectStore.getState().providers;
    if (storeProviders.length > 0) {
      setProviders(storeProviders);
      const defaultProvider = storeProviders.find((p) => p.isDefault) ?? storeProviders[0];
      if (defaultProvider && !selectedProviderId) setSelectedProviderId(defaultProvider.id);
    } else {
      api.getProviders().then((data) => {
        setProviders(data);
        const defaultProvider = data.find((p) => p.isDefault) ?? data[0];
        if (defaultProvider && !selectedProviderId) setSelectedProviderId(defaultProvider.id);
      }).catch(() => {});
    }
  }, [showInitForm, selectedProviderId]);

  const handleInit = async () => {
    setLoading(true);
    try {
      const result = await api.initSupervisionAgent(
        projectId,
        initConfig as SupervisorConfig,
        selectedProviderId || undefined,
        initMode,
      );
      setAgent(projectId, result);
      setShowInitForm(false);
      // Navigate to the supervisor main session
      if (result.mainSessionId) {
        selectSession(result.mainSessionId);
      }
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

        {/* Mode */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Mode</label>
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5">
            <button
              onClick={() => setInitMode('lite')}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                initMode === 'lite'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Workflow Runner
            </button>
            <button
              onClick={() => setInitMode('full')}
              className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                initMode === 'full'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Full Supervisor
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {initMode === 'lite'
              ? 'Lightweight: retry, scheduling, serial dependencies'
              : 'Full: autonomous task orchestration with review & git integration'}
          </p>
        </div>

        {/* Provider */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Provider</label>
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full px-2 py-1.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
            ))}
          </select>
        </div>

        {/* Trust Level — full mode only */}
        {initMode === 'full' && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Trust Level</label>
            <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5">
              {(['low', 'medium', 'high'] as TrustLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setInitConfig((c) => ({ ...c, trustLevel: level }))}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    initConfig.trustLevel === level
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {trustLevelLabels[level].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {trustLevelLabels[initConfig.trustLevel ?? 'medium'].desc}
            </p>
          </div>
        )}

        {/* Max Concurrent Tasks — full mode only */}
        {initMode === 'full' && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max Concurrent Tasks</label>
            <input
              type="number"
              value={initConfig.maxConcurrentTasks ?? 2}
              onChange={(e) => setInitConfig((c) => ({ ...c, maxConcurrentTasks: parseInt(e.target.value) || 1 }))}
              min={1}
              max={5}
              className="w-20 px-2 py-1.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowInitForm(false)}
            className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleInit}
            disabled={loading || !selectedProviderId}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Agent'}
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
          {(agent.mode ?? 'full') === 'lite' ? 'Workflow' : 'Supervisor'}
          {(agent.mode ?? 'full') === 'full' && ` | ${agent.config.maxConcurrentTasks} concurrent | Trust: ${trustLevelLabels[agent.config.trustLevel]?.label ?? agent.config.trustLevel}`}
        </span>

        {/* Paused reason */}
        {agent.phase === 'paused' && agent.pausedReason && (
          <span className="text-xs text-orange-500">
            ({agent.pausedReason === 'budget' ? 'Budget limit' : agent.pausedReason === 'sync_error' ? 'Sync error' : 'User paused'})
          </span>
        )}

        {/* Link to main session */}
        {agent.mainSessionId && (
          <button
            onClick={() => onOpenSession ? onOpenSession() : selectSession(agent.mainSessionId!)}
            className="text-xs text-primary hover:underline"
          >
            Open Session
          </button>
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
