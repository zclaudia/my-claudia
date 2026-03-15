import { X } from 'lucide-react';
import { useMemo } from 'react';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface DiffViewerModalProps {
  title: string;
  diff: string;
  onClose: () => void;
}

type LineType = 'add' | 'remove' | 'header' | 'range' | 'normal';

function classifyLine(line: string): LineType {
  if (line.startsWith('+++') || line.startsWith('---')) return 'header';
  if (line.startsWith('@@')) return 'range';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'normal';
}

const LINE_STYLES: Record<LineType, string> = {
  add: 'bg-green-500/15 text-green-400',
  remove: 'bg-red-500/15 text-red-400',
  header: 'text-blue-400 font-semibold',
  range: 'text-cyan-400 bg-cyan-500/10',
  normal: 'text-foreground/80',
};

export function DiffViewerModal({ title, diff, onClose }: DiffViewerModalProps) {
  useAndroidBack(onClose, true, 30);
  const lines = useMemo(() => {
    return diff.split('\n').map((text, i) => {
      const type = classifyLine(text);
      return { key: i, text, type };
    });
  }, [diff]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 safe-top-pad safe-bottom-pad" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-xl shadow-xl w-[90vw] max-w-4xl max-h-[80vh] flex flex-col"
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 1.5rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold truncate" title={title}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-0">
          <pre className="text-xs font-mono leading-5">
            {lines.map((line) => (
              <div key={line.key} className={`px-4 ${LINE_STYLES[line.type]}`}>
                {line.text || '\u00A0'}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
