import { useEffect, type RefObject } from 'react';
import { isAndroid } from '../../utils/platform';

/**
 * Mobile: keep chat pinned to the visible viewport when soft keyboard opens.
 * Android Tauri WebView already uses adjustResize, so the layout shrinks with
 * the keyboard automatically. Applying visualViewport-based fixed positioning on
 * top of that causes the composer to float above the keyboard.
 */
export function useMobileViewport(chatRootRef: RefObject<HTMLDivElement | null>, isMobile: boolean) {
  useEffect(() => {
    if (!isMobile) return;
    if (isAndroid()) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const el = chatRootRef.current;
      if (!el) return;
      const h = Math.min(window.innerHeight, vv.height);
      if (h < window.innerHeight) {
        el.style.position = 'fixed';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.height = `${h}px`;
      } else {
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
        el.style.height = '';
      }
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      const el = chatRootRef.current;
      if (el) {
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
        el.style.height = '';
      }
    };
  }, [isMobile]);
}
