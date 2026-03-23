import { useEffect, useState, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const DRAG_THRESHOLD_PX = 6;

interface ClaudiaWindowContext {
  serverUrl?: string;
  authToken?: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
  projectId?: string | null;
  contextProjectId?: string | null;
}

/**
 * Standalone floating ball window — rendered in a small transparent Tauri window.
 *
 * Interaction:
 * - Pointer stays within threshold → click (toggle chat)
 * - Pointer moves beyond threshold → start Tauri window drag
 */
/** Derive ring status from unread + running + permission state. */
type RingStatus = 'idle' | 'running' | 'unread' | 'permission_pending';

function getRingStatus(hasUnread: boolean, hasRunning: boolean, hasPermissionPending: boolean): RingStatus {
  if (hasPermissionPending) return 'permission_pending';
  if (hasUnread) return 'unread';
  if (hasRunning) return 'running';
  return 'idle';
}

const RING_COLORS: Record<RingStatus, { bg: string; glow: string }> = {
  idle:               { bg: 'rgba(34,197,94,0.35)',  glow: 'rgba(34,197,94,0.5)'  },  // green
  running:            { bg: 'rgba(234,179,8,0.4)',   glow: 'rgba(234,179,8,0.6)'  },  // yellow/amber
  unread:             { bg: 'rgba(239,68,68,0.4)',   glow: 'rgba(239,68,68,0.6)'  },  // red
  permission_pending: { bg: 'rgba(249,115,22,0.42)', glow: 'rgba(249,115,22,0.68)' },  // orange
};

export function ClaudiaBallWindow() {
  const [hasUnread, setHasUnread] = useState(false);
  const [hasRunning, setHasRunning] = useState(false);
  const [hasPermissionPending, setHasPermissionPending] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [context, setContext] = useState<ClaudiaWindowContext>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      serverUrl: params.get('serverUrl') || undefined,
      authToken: params.get('authToken') || undefined,
      serverId: params.get('serverId') || undefined,
      serverName: params.get('serverName') || undefined,
      gatewayUrl: params.get('gatewayUrl') || undefined,
      gatewaySecret: params.get('gatewaySecret') || undefined,
      projectId: params.get('projectId'),
    };
  });
  const pointerDown = useRef(false);
  const dragStarted = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  // Make everything transparent + hide scrollbars
  useEffect(() => {
    // Inject high-priority CSS to override theme background
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after,
      html, body, #root, div {
        background: transparent !important;
        background-color: transparent !important;
      }
      html, body, #root {
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        min-height: 0 !important;
        min-width: 0 !important;
        width: 80px !important;
        height: 80px !important;
      }
      img { background: transparent !important; }
      @keyframes claudia-ball-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes claudia-ring-pulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.06); }
      }
      @keyframes claudia-ring-rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes claudia-running-orbit {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes claudia-halo-breathe {
        0%, 100% { opacity: 0.35; transform: scale(0.9); }
        50% { opacity: 1; transform: scale(1.14); }
      }
      @keyframes claudia-ring-breathe {
        0%, 100% { opacity: 0.55; transform: scale(0.96); }
        50% { opacity: 1; transform: scale(1.06); }
      }
      ::-webkit-scrollbar { display: none !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // Track system dark/light mode changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Listen for unread notifications
  useEffect(() => {
    let cleanupUnread: (() => void) | undefined;
    let cleanupContext: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        cleanupUnread = await listen<{ unread: boolean; running?: boolean; permissionPending?: boolean }>('claudia:unread', (e) => {
          setHasUnread(e.payload.unread);
          setHasRunning(e.payload.running ?? false);
          setHasPermissionPending(e.payload.permissionPending ?? false);
        });
        cleanupContext = await listen<ClaudiaWindowContext>('claudia:context', (e) => {
          setContext((prev) => ({ ...prev, ...e.payload }));
        });
      } catch { /* not ready */ }
    })();
    return () => {
      cleanupUnread?.();
      cleanupContext?.();
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerDown.current = true;
    dragStarted.current = false;
    didDrag.current = false;
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerDown.current || dragStarted.current || !pointerStart.current) return;

    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    dragStarted.current = true;
    didDrag.current = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch { /* ignore */ }
  };

  const handlePointerUp = () => {
    pointerDown.current = false;
    pointerStart.current = null;
    if (!didDrag.current) {
      void toggleChat();
    }
    dragStarted.current = false;
  };

  const handlePointerCancel = () => {
    pointerDown.current = false;
    dragStarted.current = false;
    pointerStart.current = null;
  };

  const toggleChat = async () => {
    setIsOpening(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const chatParams = new URLSearchParams({ claudiaChat: 'true' });
      for (const [key, value] of Object.entries(context)) {
        if (value) chatParams.set(key, value);
      }

      await invoke('toggle_claudia_chat', {
        chatUrl: `${window.location.origin}${window.location.pathname}?${chatParams}`,
        screenWidth: window.screen.availWidth,
        screenHeight: window.screen.availHeight,
      });
    } catch (err) {
      console.error('[ClaudiaBall] toggleChat failed:', err);
    } finally {
      setIsOpening(false);
    }
  };

  const ringStatus = getRingStatus(hasUnread, hasRunning, hasPermissionPending);
  const ringColor = RING_COLORS[ringStatus];

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDragStart={(event) => event.preventDefault()}
      draggable={false}
      style={{
        width: 80,
        height: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        // @ts-expect-error — WebkitAppRegion is a non-standard CSS property
        WebkitAppRegion: 'no-drag',
      }}
    >
      {/* Outer glassmorphism status ring */}
      <div
        style={{
          width: 68,
          height: 68,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          pointerEvents: 'none',
          animation: ringStatus === 'unread' ? 'claudia-ring-pulse 2s ease-in-out infinite' : 'none',
        }}
      >
        {/* Halo layer — avoids box-shadow because transparent Tauri windows can rasterize it as a square */}
        <div
          style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            background: ringStatus === 'running'
              ? `conic-gradient(from 0deg, transparent 0%, ${ringColor.glow} 18%, ${ringColor.bg} 32%, transparent 58%)`
              : `radial-gradient(circle, ${ringColor.glow} 0%, ${ringColor.bg} 42%, rgba(255,255,255,0) 74%)`,
            opacity: ringStatus === 'idle' ? 0.75 : 1,
            transition: 'background 0.5s ease, opacity 0.5s ease',
            willChange: 'transform, opacity',
            animation: ringStatus === 'running'
              ? 'claudia-ring-rotate 3s linear infinite'
              : ringStatus === 'permission_pending'
                ? 'claudia-ring-pulse 1.4s ease-in-out infinite'
              : ringStatus === 'idle'
                ? 'claudia-halo-breathe 2.6s ease-in-out infinite'
                : 'none',
          }}
        />

        {/* Ring background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.14)',
            border: `2.5px solid ${ringColor.glow}`,
            transition: 'border-color 0.5s ease, background 0.5s ease',
            willChange: 'transform, opacity',
            animation: ringStatus === 'permission_pending'
              ? 'claudia-ring-pulse 1.4s ease-in-out infinite'
              : ringStatus === 'idle'
                ? 'claudia-ring-breathe 2.6s ease-in-out infinite'
                : 'none',
          }}
        />

        {ringStatus === 'running' && (
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: '50%',
              animation: 'claudia-running-orbit 1.4s linear infinite',
              willChange: 'transform',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: '50%',
                width: 6,
                height: 6,
                marginLeft: -3,
                borderRadius: '50%',
                background: ringColor.glow,
                boxShadow: `0 0 0 2px ${ringColor.bg}`,
              }}
            />
          </div>
        )}

        {/* Inner ball — logo */}
        <div
          onDragStart={(event) => event.preventDefault()}
          draggable={false}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
            overflow: 'hidden',
          }}
        >
          {isOpening ? (
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.35)',
                borderTopColor: 'white',
                animation: 'claudia-ball-spin 0.8s linear infinite',
                boxSizing: 'border-box',
              }} />
            </div>
          ) : (
            <img
              src={isDark ? '/logo-transparent-dark.png' : '/logo.png'}
              alt="Claudia"
              draggable={false}
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                objectFit: 'cover',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
