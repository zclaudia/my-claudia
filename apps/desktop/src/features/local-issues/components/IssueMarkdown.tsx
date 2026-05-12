import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme, isDarkTheme } from '../../../contexts/ThemeContext';

interface IssueMarkdownProps {
  content: string;
  /** Smaller font sizing for inline contexts (comments). */
  compact?: boolean;
}

/**
 * Inline markdown renderer used by issue description and comment bodies.
 * Wraps `react-markdown` + `remark-gfm` with Tailwind `prose` styling so it
 * blends in with the issue detail view without inheriting the full-page
 * padding of `MarkdownFileContent`.
 */
export function IssueMarkdown({ content, compact = false }: IssueMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const dark = isDarkTheme(resolvedTheme);
  const size = compact ? 'prose-xs' : 'prose-sm';
  return (
    <div className={`prose ${size} max-w-none min-w-0 ${dark ? 'dark:prose-invert' : ''} prose-pre:my-2 prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5`}>
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
