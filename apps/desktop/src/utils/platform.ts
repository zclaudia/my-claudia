/** Centralized platform detection — evaluate at call time instead of module load time. */

/** Running inside Tauri (desktop or mobile) */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Running on Android (Tauri mobile) */
export function isAndroid(): boolean {
  return isTauri() && navigator.userAgent.includes('Android');
}

/** Running on Windows (Tauri desktop) */
export function isWindows(): boolean {
  return isTauri() && navigator.userAgent.includes('Windows');
}

/** Running on macOS (Tauri desktop, not Android, not Windows) */
export function isMacOS(): boolean {
  return isTauri() && !isAndroid() && navigator.platform.includes('Mac');
}

/** Desktop Tauri (not Android) — includes Windows + macOS + Linux */
export function isDesktopTauri(): boolean {
  return isTauri() && !isAndroid();
}

/** Desktop Tauri excluding Windows (macOS + Linux) — used for embedded server */
export function isDesktopTauriNonWindows(): boolean {
  return isDesktopTauri() && !isWindows();
}
