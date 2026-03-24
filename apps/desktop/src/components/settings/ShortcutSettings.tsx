import { useState, useEffect } from 'react';
import { useShortcutStore, MODIFIER_KEYS, MAIN_KEYS, formatShortcutForDisplay, parseShortcut, buildShortcut, type ModifierKey, type MainKey } from '../../stores/shortcutStore';

export function ShortcutSettings({ disabled = false }: { disabled?: boolean }) {
  const { shortcut, enabled, isLoading, error, toggleEnabled, updateShortcut, resetToDefault } = useShortcutStore();
  const [isEditing, setIsEditing] = useState(false);
  const [tempModifiers, setTempModifiers] = useState<ModifierKey[]>([]);
  const [tempMainKey, setTempMainKey] = useState<MainKey | null>(null);

  // Parse current shortcut when entering edit mode
  useEffect(() => {
    if (isEditing) {
      const { modifiers, mainKey } = parseShortcut(shortcut);
      setTempModifiers(modifiers);
      setTempMainKey(mainKey);
    }
  }, [isEditing, shortcut]);

  const handleSave = async () => {
    if (!tempMainKey) return;
    const newShortcut = buildShortcut(tempModifiers, tempMainKey);
    const success = await updateShortcut(newShortcut);
    if (success) {
      setIsEditing(false);
    }
  };

  const handleReset = async () => {
    const success = await resetToDefault();
    if (success) {
      setIsEditing(false);
    }
  };

  const toggleModifier = (modifier: ModifierKey) => {
    setTempModifiers(prev => 
      prev.includes(modifier) 
        ? prev.filter(m => m !== modifier)
        : [...prev, modifier]
    );
  };

  const displayShortcut = formatShortcutForDisplay(shortcut);
  const isMac = typeof window !== 'undefined' && navigator.platform.includes('Mac');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <div>
            <span className="text-sm">Global Shortcut</span>
            <p className="text-xs text-muted-foreground">
              Toggle Claudia from anywhere
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <button
                onClick={() => setIsEditing(true)}
                disabled={isLoading || disabled}
                className="px-3 py-1.5 text-xs font-medium bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md transition-colors"
              >
                {displayShortcut}
              </button>
              <button
                onClick={() => void toggleEnabled()}
                disabled={isLoading || disabled}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  enabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    enabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-destructive px-3">
          {error}
        </div>
      )}

      {disabled && (
        <div className="text-xs text-muted-foreground px-3">
          Claudia 关闭时，桌面悬浮球和全局快捷键都会一起停用。
        </div>
      )}

      {isEditing && (
        <div className="p-3 bg-secondary/30 rounded-lg space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Modifier Keys</div>
          <div className="flex flex-wrap gap-1.5">
            {MODIFIER_KEYS.map(modifier => {
              // Skip platform-specific modifiers
              if (isMac && modifier === 'Ctrl') return null;
              if (!isMac && (modifier === 'Cmd' || modifier === 'Option')) return null;
              
              const display = modifier === 'CmdOrCtrl'
                ? (isMac ? '⌘' : 'Ctrl')
                : modifier === 'Cmd' ? '⌘'
                : modifier === 'Ctrl' ? 'Ctrl'
                : modifier === 'Option' ? '⌥'
                : modifier === 'Alt' ? 'Alt'
                : '⇧';
              
              const isSelected = tempModifiers.includes(modifier);
              
              return (
                <button
                  key={modifier}
                  onClick={() => toggleModifier(modifier)}
                  disabled={disabled}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    isSelected 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                  }`}
                >
                  {display}
                </button>
              );
            })}
          </div>

          <div className="text-xs font-medium text-muted-foreground mt-3">Main Key</div>
          <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
            {MAIN_KEYS.map(key => (
              <button
                key={key}
                onClick={() => setTempMainKey(key)}
                disabled={disabled}
                className={`px-1 py-1 text-xs rounded-md transition-colors ${
                  tempMainKey === key 
                    ? 'bg-primary text-primary-foreground' 
                    : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <button
              onClick={handleReset}
              disabled={isLoading || disabled}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => setIsEditing(false)}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={isLoading || disabled || !tempMainKey || tempModifiers.length === 0}
              className="px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
