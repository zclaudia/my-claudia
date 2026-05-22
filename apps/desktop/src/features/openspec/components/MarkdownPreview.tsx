// apps/desktop/src/features/openspec/components/MarkdownPreview.tsx
//
// Reusable markdown preview wrapper around react-markdown + remark-gfm. Used in
// SpecChange artifact tabs to render proposal/design/tasks/delta content with
// theme-token styling. Headings h1-h4 map to the OpenSpec section hierarchy
// (e.g. h3 = `## ADDED Requirements` rows after GFM strikethrough, h3 =
// `### Requirement: ...`, h4 = `#### Scenario: ...`).

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  className?: string;
}

/**
 * Wraps react-markdown with theme-token styling. Used in SpecChange artifact
 * tabs. Renders Requirement / Scenario blocks (which are h3 / h4 in OpenSpec
 * format) with distinct styling.
 */
export function MarkdownPreview({ content, className = '' }: Props): React.ReactElement {
  return (
    <div className={`prose prose-sm max-w-none text-foreground ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold mb-3 mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold mt-4 mb-2 border-b border-border pb-1">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-medium mt-2 mb-1 text-muted-foreground uppercase tracking-wide">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-sm mb-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="text-sm list-disc pl-5 space-y-0.5 mb-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="text-sm list-decimal pl-5 space-y-0.5 mb-2">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children, className: cls }) => {
            const isBlock = (cls ?? '').includes('language-');
            return isBlock ? (
              <code className="block bg-muted px-2 py-1 rounded text-xs font-mono overflow-x-auto">
                {children}
              </code>
            ) : (
              <code className="px-1 py-0.5 bg-muted rounded text-xs font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto mb-2">
              {children}
            </pre>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
