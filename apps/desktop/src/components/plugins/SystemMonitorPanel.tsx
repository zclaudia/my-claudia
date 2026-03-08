import { useEffect, useState, useCallback } from 'react';
import { fetchLocalApi } from '../../services/api';
import { Cpu, MemoryStick, Clock, RefreshCw } from 'lucide-react';

interface SystemStats {
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
    loadAvg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
  platform: string;
  hostname: string;
  nodeVersion: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function GaugeBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

function StatCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function SystemMonitorPanel() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const result = await fetchLocalApi<SystemStats>('/api/system/stats');
      if (result.success && result.data) {
        setStats(result.data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      setError('Failed to fetch system stats');
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading system stats...
      </div>
    );
  }

  const cpuColor = stats.cpu.usagePercent > 80 ? 'bg-red-500' : stats.cpu.usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-500';
  const memColor = stats.memory.usagePercent > 80 ? 'bg-red-500' : stats.memory.usagePercent > 60 ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{stats.hostname}</h2>
          <p className="text-xs text-muted-foreground">{stats.platform} · {stats.nodeVersion}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastUpdated && (
            <span className="flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* CPU */}
        <StatCard icon={<Cpu className="w-4 h-4" />} title="CPU">
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-bold tabular-nums">{stats.cpu.usagePercent}%</span>
              <span className="text-xs text-muted-foreground">{stats.cpu.cores} cores</span>
            </div>
            <GaugeBar percent={stats.cpu.usagePercent} color={cpuColor} />
            <p className="text-xs text-muted-foreground truncate">{stats.cpu.model}</p>
            <div className="text-xs text-muted-foreground">
              Load: {stats.cpu.loadAvg.map(v => v.toFixed(2)).join(' / ')}
            </div>
          </div>
        </StatCard>

        {/* Memory */}
        <StatCard icon={<MemoryStick className="w-4 h-4" />} title="Memory">
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-bold tabular-nums">{stats.memory.usagePercent}%</span>
              <span className="text-xs text-muted-foreground">{formatBytes(stats.memory.total)}</span>
            </div>
            <GaugeBar percent={stats.memory.usagePercent} color={memColor} />
            <div className="text-xs text-muted-foreground">
              Used: {formatBytes(stats.memory.used)}
            </div>
            <div className="text-xs text-muted-foreground">
              Free: {formatBytes(stats.memory.free)}
            </div>
          </div>
        </StatCard>

        {/* Uptime */}
        <StatCard icon={<Clock className="w-4 h-4" />} title="System">
          <div className="space-y-2">
            <div className="text-2xl font-bold tabular-nums">{formatUptime(stats.uptime)}</div>
            <p className="text-xs text-muted-foreground">Uptime</p>
            <div className="text-xs text-muted-foreground mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
              System healthy
            </div>
          </div>
        </StatCard>
      </div>
    </div>
  );
}
