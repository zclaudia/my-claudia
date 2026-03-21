import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo } from 'react';
import { useTheme, isDarkTheme } from '../../contexts/ThemeContext';

function normalizeMarkdownForRender(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const fenceCount = (normalized.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    return `${normalized}\n\`\`\``;
  }
  return normalized;
}

interface MarkdownFileContentProps {
  content: string;
}

export function MarkdownFileContent({ content }: MarkdownFileContentProps) {
  const { resolvedTheme } = useTheme();
  const dark = isDarkTheme(resolvedTheme);
  const normalizedContent = useMemo(() => normalizeMarkdownForRender(content), [content]);

  return (
    <div className="w-full h-full overflow-auto p-4 md:p-6">
      <div className={`prose prose-sm max-w-none min-w-0 ${dark ? 'dark:prose-invert' : ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ children }) {
              return (
                <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                  <pre>{children}</pre>
                </div>
              );
            },
            table({ children }) {
              return (
                <div className="w-full overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
                  <table className="w-max min-w-full border-collapse border border-border">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border border-border px-3 py-2 bg-secondary text-left align-top whitespace-pre-wrap break-words">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return (
                <td className="border border-border px-3 py-2 align-top whitespace-pre-wrap break-words">
                  {children}
                </td>
              );
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}
