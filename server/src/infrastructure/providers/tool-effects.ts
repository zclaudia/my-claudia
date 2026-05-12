import type { FileChangeEffectFile, ToolEffect } from '@my-claudia/shared/core/message';

const DEFAULT_PATH_KEYS = [
  'file_path',
  'notebook_path',
  'path',
  'file',
  'filename',
  'target_file',
  'targetFile',
  'relative_path',
  'relativePath',
  'absolute_path',
  'absolutePath',
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readStringField(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function cleanEffectPath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  let value = rawPath.trim();
  if (!value || value === '/dev/null') return undefined;
  value = value.replace(/^["']|["']$/g, '');
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  const tabIdx = value.indexOf('\t');
  if (tabIdx >= 0) value = value.slice(0, tabIdx);
  return value || undefined;
}

function looksLikeFilePath(rawPath: string | undefined): boolean {
  const path = cleanEffectPath(rawPath);
  if (!path) return false;
  return path.startsWith('/')
    || path.startsWith('./')
    || path.startsWith('../')
    || path.includes('/')
    || /\.[A-Za-z0-9][A-Za-z0-9_-]{0,12}$/.test(path);
}

export function makeShellEffect(command: string | undefined): ToolEffect | undefined {
  const trimmed = command?.trim();
  return trimmed ? { kind: 'shell', command: trimmed } : undefined;
}

export function makeFileChangeEffect(files: FileChangeEffectFile[]): ToolEffect | undefined {
  const normalized = files
    .map((file) => ({
      ...file,
      path: cleanEffectPath(file.path) ?? '',
      changeKind: file.changeKind ?? ('unknown' as const),
    }))
    .filter((file) => file.path);
  return normalized.length > 0 ? { kind: 'file_change', files: normalized } : undefined;
}

export function fileChangeEffectFromInput(
  input: unknown,
  changeKind: FileChangeEffectFile['changeKind'] = 'unknown',
): ToolEffect | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  const path = cleanEffectPath(readStringField(record, DEFAULT_PATH_KEYS));
  if (!path) return undefined;
  const summary = readStringField(record, ['summary', 'changes', 'diff', 'patch', 'unified_diff', 'unifiedDiff']);
  return makeFileChangeEffect([{ path, changeKind, summary }]);
}

function summarizeStructuredChange(change: unknown): string | undefined {
  if (typeof change === 'string') return change;
  const record = asRecord(change);
  if (!record) return undefined;
  const detail = readStringField(record, [
    'unified_diff',
    'unifiedDiff',
    'diff',
    'patch',
    'changes',
    'content',
    'summary',
    'description',
  ]);
  if (detail) return detail;
  const type = readStringField(record, ['type', 'status', 'kind']);
  return type ? `(${type})` : JSON.stringify(record);
}

function changeKindFromStructuredChange(change: unknown): FileChangeEffectFile['changeKind'] {
  const record = asRecord(change);
  const raw = record ? readStringField(record, ['type', 'status', 'kind'])?.toLowerCase() : undefined;
  if (raw === 'add' || raw === 'create' || raw === 'new') return 'add';
  if (raw === 'delete' || raw === 'remove' || raw === 'deleted') return 'delete';
  if (raw === 'rename' || raw === 'move') return 'rename';
  if (raw === 'modify' || raw === 'modified' || raw === 'update' || raw === 'updated') return 'modify';
  return 'unknown';
}

export function fileChangeEffectFromMap(value: unknown): ToolEffect | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const files: FileChangeEffectFile[] = [];
  for (const [rawPath, change] of Object.entries(record)) {
    const path = cleanEffectPath(rawPath);
    if (!path) continue;
    files.push({
      path,
      changeKind: changeKindFromStructuredChange(change),
      summary: summarizeStructuredChange(change),
    });
  }
  return makeFileChangeEffect(files);
}

export function fileChangeEffectFromArray(value: unknown): ToolEffect | undefined {
  if (!Array.isArray(value)) return undefined;
  const files: FileChangeEffectFile[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const path = cleanEffectPath(readStringField(record, DEFAULT_PATH_KEYS));
    if (!path) continue;
    files.push({
      path,
      changeKind: changeKindFromStructuredChange(record),
      summary: summarizeStructuredChange(record),
    });
  }
  return makeFileChangeEffect(files);
}

export function fileChangeEffectFromSummaryText(text: string | undefined): ToolEffect | undefined {
  if (!text?.trim()) return undefined;
  const lines = text.split(/\r?\n/);
  const byPath = new Map<string, string[]>();
  let currentPath: string | undefined;

  const setCurrentPath = (rawPath: string | undefined) => {
    const path = cleanEffectPath(rawPath);
    if (!path) return;
    currentPath = path;
    if (!byPath.has(path)) byPath.set(path, []);
  };

  for (const line of lines) {
    const gitDiff = line.match(/^diff --git\s+(?:"?a\/(.+?)"?\s+)?(?:"?b\/(.+?)"?)\s*$/);
    if (gitDiff) setCurrentPath(gitDiff[2] ?? gitDiff[1]);

    const plusPath = line.match(/^\+\+\+\s+(.+)$/);
    if (plusPath) setCurrentPath(plusPath[1]);

    const patchPath = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/);
    if (patchPath) setCurrentPath(patchPath[1]);

    const headerPath = line.match(/^([^:\n]+):(?:\s+\((?:new file|deleted|modified|updated|renamed)\))?\s*$/i);
    if (headerPath
      && !line.startsWith('+')
      && !line.startsWith('-')
      && !line.startsWith('@')
      && looksLikeFilePath(headerPath[1])) {
      setCurrentPath(headerPath[1]);
    }

    if (currentPath) byPath.get(currentPath)?.push(line);
  }

  return makeFileChangeEffect(Array.from(byPath.entries()).map(([path, summaryLines]) => ({
    path,
    changeKind: 'unknown',
    summary: summaryLines.join('\n').trim() || text,
  })));
}
