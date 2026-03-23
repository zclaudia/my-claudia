import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'claudia-shortcut-config';

// Default shortcut must stay in Tauri/global-hotkey parser format.
export const DEFAULT_SHORTCUT = 'CmdOrCtrl+Shift+.';

// Supported modifier keys
export const MODIFIER_KEYS = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Option', 'Alt', 'Shift'] as const;
export type ModifierKey = typeof MODIFIER_KEYS[number];

// Supported main keys (common shortcut keys)
export const MAIN_KEYS = [
  '.', ',', '/', ';', "'",
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Space', 'Tab', 'Escape', 'Enter',
] as const;
export type MainKey = typeof MAIN_KEYS[number];

export interface ShortcutConfig {
  shortcut: string; // Full shortcut string like "CmdOrCtrl+Shift+."
  enabled: boolean;
}

interface ShortcutState extends ShortcutConfig {
  isLoading: boolean;
  error: string | null;
  
  // Actions
  loadConfig: () => Promise<void>;
  updateShortcut: (shortcut: string) => Promise<boolean>;
  toggleEnabled: () => Promise<boolean>;
  resetToDefault: () => Promise<boolean>;
}

function loadStoredConfig(): ShortcutConfig {
  if (typeof window === 'undefined') {
    return { shortcut: DEFAULT_SHORTCUT, enabled: true };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShortcutConfig;
      return {
        shortcut: parsed.shortcut || DEFAULT_SHORTCUT,
        enabled: parsed.enabled !== false, // default to true
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { shortcut: DEFAULT_SHORTCUT, enabled: true };
}

function saveStoredConfig(config: ShortcutConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

const LEGACY_MODIFIER_MAP: Record<string, ModifierKey> = {
  CmdOrControl: 'CmdOrCtrl',
  Command: 'Cmd',
  Control: 'Ctrl',
};

const LEGACY_MAIN_KEY_MAP: Record<string, MainKey> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
};

function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split('+').filter(Boolean);
  if (parts.length === 0) return DEFAULT_SHORTCUT;

  const normalized = parts.map((part, index) => {
    if (index === parts.length - 1) {
      return LEGACY_MAIN_KEY_MAP[part] ?? part;
    }
    return LEGACY_MODIFIER_MAP[part] ?? part;
  });

  return normalized.join('+');
}

// Build shortcut string from modifiers and main key
export function buildShortcut(modifiers: ModifierKey[], mainKey: MainKey): string {
  return [...modifiers, mainKey].join('+');
}

// Parse shortcut string into components
export function parseShortcut(shortcut: string): { modifiers: ModifierKey[]; mainKey: MainKey | null } {
  const parts = normalizeShortcut(shortcut).split('+');
  const modifiers = parts.slice(0, -1).filter((p): p is ModifierKey => 
    MODIFIER_KEYS.includes(p as ModifierKey)
  );
  const lastPart = parts[parts.length - 1];
  const mainKey = MAIN_KEYS.includes(lastPart as MainKey) ? (lastPart as MainKey) : null;
  return { modifiers, mainKey };
}

// Format shortcut for display (replace CmdOrControl with platform-specific)
export function formatShortcutForDisplay(shortcut: string): string {
  const isMac = typeof window !== 'undefined' && navigator.platform.includes('Mac');
  return normalizeShortcut(shortcut)
    .replace('CmdOrCtrl', isMac ? '⌘' : 'Ctrl')
    .replace('Cmd', '⌘')
    .replace('Ctrl', 'Ctrl')
    .replace('Option', '⌥')
    .replace('Alt', 'Alt')
    .replace('Shift', '⇧')
    .replace(/\+/g, ' ');
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  ...loadStoredConfig(),
  isLoading: false,
  error: null,

  loadConfig: async () => {
    const config = loadStoredConfig();
    const normalizedConfig = {
      shortcut: normalizeShortcut(config.shortcut),
      enabled: config.enabled,
    };
    set({ ...normalizedConfig, isLoading: true, error: null });
    
    try {
      // Apply the loaded config to the backend
      await invoke('update_global_shortcut', { 
        shortcut: normalizedConfig.enabled ? normalizedConfig.shortcut : null 
      });
      saveStoredConfig(normalizedConfig);
      set({ isLoading: false });
    } catch (err) {
      set({ 
        isLoading: false, 
        error: err instanceof Error ? err.message : 'Failed to apply shortcut config' 
      });
    }
  },

  updateShortcut: async (shortcut: string) => {
    const normalizedShortcut = normalizeShortcut(shortcut);
    set({ isLoading: true, error: null });
    
    try {
      await invoke('update_global_shortcut', { 
        shortcut: get().enabled ? normalizedShortcut : null 
      });
      
      const newConfig = { ...get(), shortcut: normalizedShortcut, isLoading: false };
      saveStoredConfig(newConfig);
      set(newConfig);
      return true;
    } catch (err) {
      set({ 
        isLoading: false, 
        error: err instanceof Error ? err.message : 'Failed to update shortcut' 
      });
      return false;
    }
  },

  toggleEnabled: async () => {
    const { enabled, shortcut } = get();
    const newEnabled = !enabled;
    set({ isLoading: true, error: null });
    
    try {
      await invoke('update_global_shortcut', { 
        shortcut: newEnabled ? shortcut : null 
      });
      
      const newConfig = { shortcut, enabled: newEnabled, isLoading: false, error: null };
      saveStoredConfig(newConfig);
      set(newConfig);
      return true;
    } catch (err) {
      set({ 
        isLoading: false, 
        error: err instanceof Error ? err.message : 'Failed to toggle shortcut' 
      });
      return false;
    }
  },

  resetToDefault: async () => {
    set({ isLoading: true, error: null });
    
    try {
      await invoke('update_global_shortcut', { shortcut: DEFAULT_SHORTCUT });
      
      const newConfig = { shortcut: DEFAULT_SHORTCUT, enabled: true, isLoading: false, error: null };
      saveStoredConfig(newConfig);
      set(newConfig);
      return true;
    } catch (err) {
      set({ 
        isLoading: false, 
        error: err instanceof Error ? err.message : 'Failed to reset shortcut' 
      });
      return false;
    }
  },
}));
