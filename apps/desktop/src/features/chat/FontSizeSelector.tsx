import { useUIStore, type FontSizePreset } from '../../stores/uiStore';

const PRESETS: { key: FontSizePreset; label: string }[] = [
  { key: 'small', label: 'A' },
  { key: 'medium', label: 'A' },
  { key: 'large', label: 'A' },
];

export function FontSizeSelector() {
  const { fontSize, setFontSize } = useUIStore();

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded" title="Font size">
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          onClick={() => setFontSize(preset.key)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            fontSize === preset.key
              ? 'bg-background shadow text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          style={{
            fontSize: preset.key === 'small' ? '10px' : preset.key === 'large' ? '15px' : '12px',
            lineHeight: 1,
          }}
          title={`${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)} font`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
