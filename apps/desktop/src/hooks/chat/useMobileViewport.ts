import { useEffect, type RefObject } from 'react';

const KEYBOARD_OVERLAY_THRESHOLD_PX = 80;

/**
 * Mobile: keep chat pinned to the visible viewport when soft keyboard opens.
 * When the native shell already resizes the layout viewport, leave CSS layout
 * alone. When the keyboard overlays the webview, pin the chat root to the
 * visual viewport so the composer remains visible.
 */
export function useMobileViewport(chatRootRef: RefObject<HTMLDivElement | null>, isMobile: boolean) {
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const reset = (el: HTMLDivElement) => {
      el.style.position = '';
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      el.style.width = '';
      el.style.height = '';
    };

    const sync = () => {
      const el = chatRootRef.current;
      if (!el) return;

      const keyboardOverlaysWebview = window.innerHeight - vv.height > KEYBOARD_OVERLAY_THRESHOLD_PX;
      if (keyboardOverlaysWebview) {
        el.style.position = 'fixed';
        el.style.top = `${vv.offsetTop || 0}px`;
        el.style.left = `${vv.offsetLeft || 0}px`;
        el.style.right = '0';
        el.style.width = `${vv.width}px`;
        el.style.height = `${vv.height}px`;
      } else {
        reset(el);
      }
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      const el = chatRootRef.current;
      if (el) reset(el);
    };
  }, [isMobile]);
}
