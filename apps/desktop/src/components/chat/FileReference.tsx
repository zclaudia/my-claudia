import type { ReactNode } from 'react';
import { Children } from 'react';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';

/**
 * Regex to match @file references in text.
 * Matches @followed by a path-like string (letters, numbers, /, ., -, _, etc.)
 * Must start after whitespace or at beginning of text.
 */
const FILE_REF_REGEX = /(^|[\s(])(@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g;

/**
 * Parse text content and render @file references as clickable links.
 * Non-matching text is rendered as-is.
 */
export function TextWithFileRefs({ text }: { text: string }) {
  const openFile = useFileViewerStore((s) => s.openFile);
  const projects = useProjectStore((s) => s.projects);

  const handleClick = (filePath: string) => {
    // Find project root from the first project with a rootPath
    const project = Object.values(projects).find((p) => p.rootPath);
    if (project?.rootPath) {
      openFile(project.rootPath, filePath);
      useTerminalStore.getState().setBottomPanelTab('file');
    }
  };

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  FILE_REF_REGEX.lastIndex = 0;

  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    const prefix = match[1]; // whitespace or start
    const ref = match[2];    // @path/to/file.ext
    const fullMatchStart = match.index;

    // Add text before this match (including the prefix whitespace)
    if (fullMatchStart > lastIndex) {
      parts.push(text.slice(lastIndex, fullMatchStart));
    }

    // Add the prefix (whitespace)
    if (prefix) {
      parts.push(prefix);
    }

    // Add clickable reference
    const filePath = ref.slice(1); // remove @
    parts.push(
      <button
        key={`${fullMatchStart}-${filePath}`}
        onClick={() => handleClick(filePath)}
        className="text-primary hover:underline cursor-pointer font-mono inline"
        title={`View ${filePath}`}
      >
        {ref}
      </button>
    );

    lastIndex = fullMatchStart + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // No matches, return plain text
  if (parts.length === 0) {
    return <>{text}</>;
  }

  return <>{parts}</>;
}

/**
 * Process ReactMarkdown children: replace string children containing @path
 * with clickable file references. Non-string children pass through unchanged.
 */
export function MarkdownChildrenWithFileRefs({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child === 'string' && /@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+/.test(child)) {
          return <TextWithFileRefs text={child} />;
        }
        return child;
      })}
    </>
  );
}
