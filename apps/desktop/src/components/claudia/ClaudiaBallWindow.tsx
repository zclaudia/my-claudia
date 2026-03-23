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
}

/**
 * Standalone floating ball window — rendered in a small transparent Tauri window.
 *
 * Interaction:
 * - Pointer stays within threshold → click (toggle chat)
 * - Pointer moves beyond threshold → start Tauri window drag
 */
export function ClaudiaBallWindow() {
  const [hasUnread, setHasUnread] = useState(false);
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
        cleanupUnread = await listen<{ unread: boolean }>('claudia:unread', (e) => {
          setHasUnread(e.payload.unread);
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
          pointerEvents: 'none',
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
        {hasUnread && (
          <span style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ef4444',
            border: '2px solid #1e293b',
          }} />
        )}
      </div>
    </div>
  );
}
