import { create } from 'zustand';

export type FontSizePreset = 'small' | 'medium' | 'large';

interface FontSizeConfig {
  prose: string;   // rem for prose base
  code: string;    // rem for code blocks
  input: string;   // rem for input textarea
  h1: string;      // em for h1
  h2: string;      // em for h2
  h3: string;      // em for h3
}

const FONT_CONFIGS: Record<FontSizePreset, FontSizeConfig> = {
  small: {
    prose: '0.75rem',   // 12px
    code: '0.6875rem',  // 11px
    input: '0.8125rem', // 13px
    h1: '1.5em',
    h2: '1.25em',
    h3: '1.125em',
  },
  medium: {
    prose: '0.875rem',  // 14px
    code: '0.8125rem',  // 13px
    input: '0.875rem',  // 14px
    h1: '1.715em',
    h2: '1.43em',
    h3: '1.286em',
  },
  large: {
    prose: '1rem',      // 16px
    code: '0.875rem',   // 14px
    input: '1rem',      // 16px
    h1: '2em',
    h2: '1.5em',
    h3: '1.25em',
  },
};

const STORAGE_KEY = 'my-claudia-font-size';
const ADV_INPUT_KEY = 'my-claudia-advanced-input';

function loadFontSize(): FontSizePreset {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'small' || saved === 'medium' || saved === 'large')) {
      return saved;
    }
  } catch { /* ignore */ }
  return 'medium';
}

function applyFontVars(preset: FontSizePreset) {
  const config = FONT_CONFIGS[preset];
  const root = document.documentElement;
  root.style.setProperty('--chat-font-prose', config.prose);
  root.style.setProperty('--chat-font-code', config.code);
  root.style.setProperty('--chat-font-input', config.input);
  root.style.setProperty('--chat-font-h1', config.h1);
  root.style.setProperty('--chat-font-h2', config.h2);
  root.style.setProperty('--chat-font-h3', config.h3);
}

interface UIState {
  fontSize: FontSizePreset;
  setFontSize: (size: FontSizePreset) => void;
  advancedInput: boolean;
  setAdvancedInput: (enabled: boolean) => void;
}

export const useUIStore = create<UIState>((set) => {
  const initial = loadFontSize();
  // Apply on store creation
  applyFontVars(initial);

  let advInitial = false;
  try { advInitial = localStorage.getItem(ADV_INPUT_KEY) === 'true'; } catch { /* ignore */ }

  return {
    fontSize: initial,
    setFontSize: (size) => {
      localStorage.setItem(STORAGE_KEY, size);
      applyFontVars(size);
      set({ fontSize: size });
    },
    advancedInput: advInitial,
    setAdvancedInput: (enabled) => {
      localStorage.setItem(ADV_INPUT_KEY, String(enabled));
      set({ advancedInput: enabled });
    },
  };
});

export { FONT_CONFIGS };
