// File Browser Types (@ mention support)

export type FileEntryType = 'file' | 'directory';

export interface FileEntry {
  name: string;           // e.g., "MessageInput.tsx"
  path: string;           // relative path from project root, e.g., "src/components/chat/MessageInput.tsx"
  type: FileEntryType;
  extension?: string;     // e.g., ".tsx", ".ts", ".md" (only for files)
  size?: number;          // file size in bytes (only for files)
}

export interface DirectoryListingRequest {
  projectRoot: string;    // absolute path to project root
  relativePath?: string;  // path relative to project root (default: "")
  query?: string;         // filter query (fuzzy match)
  maxResults?: number;    // limit results (default: 50)
}

export interface DirectoryListingResponse {
  entries: FileEntry[];
  currentPath: string;    // the resolved relative path
  hasMore: boolean;       // whether there are more results
}

export interface FileContentResponse {
  path: string;           // relative path from project root
  content: string;        // file content
  size: number;           // file size in bytes
}
