import { Bot } from 'lucide-react';
import type { SidebarHeaderProps } from './types';

export function SidebarHeader({ onToggle }: SidebarHeaderProps) {
  return (
    <div
      className="h-16 flex items-center justify-between pl-3 pr-3 mt-6"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Bot size={18} strokeWidth={1.75} className="text-primary" />
        </div>
        <div className="flex flex-col" data-tauri-drag-region>
          <h1 className="font-semibold text-base text-foreground leading-tight" data-tauri-drag-region>MyClaudia</h1>
          <span className="text-xs text-muted-foreground">AI Assistant</span>
        </div>
      </div>
      <button
        onClick={onToggle}
        className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
        title="Collapse sidebar"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
          />
        </svg>
      </button>
    </div>
  );
}
