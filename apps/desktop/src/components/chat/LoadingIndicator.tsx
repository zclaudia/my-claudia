import { useState, useEffect } from 'react';
import type { RunHealthStatus } from '@my-claudia/shared';
import { BrandMark } from '../BrandMark';

interface LoadingIndicatorProps {
  isLoading: boolean;
  health?: RunHealthStatus;
  loopPattern?: string;
  startedAt?: number;
  lastActivityAt?: number;
  onCancel?: () => void;
}

const THINKING_MESSAGES = [
  'Thinking...',
  'Analyzing...',
  'Processing...',
  'Reasoning...',
  'Working on it...',
];

export function LoadingIndicator({ isLoading, health, loopPattern, startedAt, lastActivityAt, onCancel }: LoadingIndicatorProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [dots, setDots] = useState('');
  const [idleTime, setIdleTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);

  // Rotate through thinking messages
  useEffect(() => {
    if (!isLoading) {
      setMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoading]);

  // Animate dots
  useEffect(() => {
    if (!isLoading) {
      setDots('');
      return;
    }

    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => clearInterval(interval);
  }, [isLoading]);

  // Track both total time and idle time (time since last activity)
  useEffect(() => {
    if (!isLoading) {
      setIdleTime(0);
      setTotalTime(0);
      return;
    }

    const updateTime = () => {
      const now = Date.now();
      if (startedAt) {
        setTotalTime(Math.floor((now - startedAt) / 1000));
      }
      if (lastActivityAt) {
        setIdleTime(Math.floor((now - lastActivityAt) / 1000));
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [isLoading, startedAt, lastActivityAt]);

  if (!isLoading) return null;

  // Determine warning state based on idle time
  const showWarning = health === 'idle' || health === 'loop' || (health === 'healthy' && idleTime > 30);
  const warningLevel: 'none' | 'slow' | 'idle' | 'loop' =
    health === 'loop' ? 'loop' :
    health === 'idle' ? 'idle' :
    idleTime > 30 ? 'slow' :
    'none';

  const warningColors = {
    none: '',
    slow: 'text-yellow-500',
    idle: 'text-amber-500',
    loop: 'text-red-500',
  };

  const warningBgColors = {
    none: '',
    slow: 'bg-yellow-500/10 border-yellow-500/20',
    idle: 'bg-amber-500/10 border-amber-500/20',
    loop: 'bg-red-500/10 border-red-500/20',
  };

  const dotColor = warningLevel === 'loop' ? 'bg-red-500' :
    warningLevel === 'idle' ? 'bg-amber-500' :
    warningLevel === 'slow' ? 'bg-yellow-500' :
    'bg-primary';

  const barColor = warningLevel === 'loop' ? 'bg-red-500' :
    warningLevel === 'idle' ? 'bg-amber-500' :
    warningLevel === 'slow' ? 'bg-yellow-500' :
    'bg-primary';

  return (
    <div className="flex items-start gap-3 px-4 py-3 animate-fade-in">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full border border-border/70 bg-card/80 dark:bg-white/5 dark:border-white/10 shadow-sm flex items-center justify-center">
        <BrandMark className="w-5 h-5 object-contain pointer-events-none select-none drop-shadow-sm" />
      </div>

      {/* Loading content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          {/* Pulsing dots animation */}
          <div className="flex gap-1">
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-bounce`} style={{ animationDelay: '0ms' }} />
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-bounce`} style={{ animationDelay: '150ms' }} />
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-bounce`} style={{ animationDelay: '300ms' }} />
          </div>

          {/* Thinking message */}
          <span className="text-sm text-muted-foreground">
            {THINKING_MESSAGES[messageIndex].replace('...', '')}{dots}
          </span>

          {/* Time display: total time and idle time */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            {/* Total time */}
            {totalTime > 0 && (
              <span>
                {totalTime < 60 ? `${totalTime}s` : `${Math.floor(totalTime / 60)}m ${totalTime % 60}s`}
              </span>
            )}
            {/* Idle time (only show if > 3 seconds) */}
            {idleTime > 3 && (
              <span className="text-muted-foreground/40">
                (idle: {idleTime < 60 ? `${idleTime}s` : `${Math.floor(idleTime / 60)}m ${idleTime % 60}s`})
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1 w-48 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${barColor} rounded-full animate-loading-bar`} />
        </div>

        {/* Warning banner */}
        {showWarning && (
          <div className={`mt-2 px-3 py-2 rounded-md border text-xs flex items-center gap-2 ${warningBgColors[warningLevel]}`}>
            <span className={warningColors[warningLevel]}>
              {warningLevel === 'loop' && `Loop detected: ${loopPattern || 'repeating pattern'}`}
              {warningLevel === 'idle' && 'No activity — task may be stuck'}
              {warningLevel === 'slow' && 'Still working...'}
            </span>
            {(warningLevel === 'idle' || warningLevel === 'loop') && onCancel && (
              <button
                onClick={onCancel}
                className="ml-auto px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
