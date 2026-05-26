import React, { useState } from 'react';

interface Props { md: string; }

export function SpecMarkdownPreview({ md }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="text-[10px] text-muted-foreground" onClick={() => setOpen(!open)}>
        {open ? 'Hide spec.md' : 'Show spec.md'} ({md.split('\n').length} lines)
      </button>
      {open && (
        <pre className="text-[10px] mt-1 max-h-64 overflow-auto bg-muted/30 p-2 rounded whitespace-pre-wrap">
          {md}
        </pre>
      )}
    </div>
  );
}
