/**
 * Agent Tools — registered to toolRegistry with scope 'agent-assistant'.
 * Injected into agent-mode sessions via MCP bridge.
 *
 * Security: shell and file-ops are restricted to the project working directory.
 */

import * as path from 'path';
import { toolRegistry } from '../plugins/tool-registry.js';
import { MemoryStore } from '../memory/memory-store.js';
import type Database from 'better-sqlite3';

/** Resolve the project working directory for a session */
function resolveProjectCwd(db: Database.Database, sessionId?: string): string | null {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT COALESCE(s.working_directory, p.root_path) as cwd
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `).get(sessionId) as { cwd: string | null } | undefined;
  return row?.cwd ?? null;
}

/** Check if a path is within the allowed base directory */
function isPathSafe(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(baseDir, filePath);
  return resolved.startsWith(path.resolve(baseDir));
}

/** Resolve and validate a file path against the project directory */
function safePath(filePath: string, baseDir: string): string | null {
  const resolved = path.resolve(baseDir, filePath);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

export function registerAgentTools(config: { getDb: () => Database.Database }): void {
  // ============================================
  // shell — execute shell commands (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_shell',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_shell',
        description: 'Execute a shell command in the project directory.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['command'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const cwd = resolveProjectCwd(db, context?.sessionId as string | undefined);
      if (!cwd) {
        return JSON.stringify({ error: 'Cannot resolve project directory for this session' });
      }

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      try {
        const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', args.command as string], {
          cwd,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        return JSON.stringify({ stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1000), exitCode: 0 });
      } catch (err: any) {
        return JSON.stringify({
          stdout: (err.stdout || '').slice(0, 4000),
          stderr: (err.stderr || err.message || '').slice(0, 1000),
          exitCode: err.code ?? 1,
        });
      }
    },
  });

  // ============================================
  // file_ops — read/write/list files (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_file_ops',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_file_ops',
        description: 'Read, write, or list files. Paths are relative to the project directory.',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['read', 'write', 'list'], description: 'File operation type' },
            path: { type: 'string', description: 'File or directory path (relative to project root)' },
            content: { type: 'string', description: 'Content to write (for write operation)' },
          },
          required: ['operation', 'path'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const projectCwd = resolveProjectCwd(db, context?.sessionId as string | undefined);
      if (!projectCwd) {
        return JSON.stringify({ error: 'Cannot resolve project directory for this session' });
      }

      const filePath = safePath(args.path as string, projectCwd);
      if (!filePath) {
        return JSON.stringify({ error: 'Path is outside the project directory' });
      }

      const fs = await import('fs/promises');
      try {
        switch (args.operation) {
          case 'read':
            return await fs.readFile(filePath, 'utf-8');
          case 'write':
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, args.content as string, 'utf-8');
            return JSON.stringify({ success: true, path: path.relative(projectCwd, filePath) });
          case 'list': {
            const entries = await fs.readdir(filePath, { withFileTypes: true });
            return JSON.stringify(entries.map(e => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
            })));
          }
          default:
            return JSON.stringify({ error: `Unknown operation: ${args.operation}` });
        }
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ============================================
  // http_request — make HTTP calls (block private IPs)
  // ============================================
  toolRegistry.register({
    id: 'agent_http_request',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_http_request',
        description: 'Make an HTTP request to an external URL. Internal/private network addresses are blocked.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Request URL (must be external)' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method (default: GET)' },
            headers: { type: 'object', description: 'Request headers' },
            body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
          },
          required: ['url'],
        },
      },
    },
    handler: async (args) => {
      const urlStr = args.url as string;
      try {
        const parsed = new URL(urlStr);
        // Block private/internal addresses
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
        if (blockedHosts.includes(parsed.hostname) || parsed.hostname.startsWith('10.') ||
            parsed.hostname.startsWith('172.') || parsed.hostname.startsWith('192.168.')) {
          return JSON.stringify({ error: 'Requests to private/internal addresses are blocked' });
        }

        const response = await fetch(urlStr, {
          method: (args.method as string) || 'GET',
          headers: (args.headers as Record<string, string>) || {},
          body: args.body as string | undefined,
        });
        const text = await response.text();
        return JSON.stringify({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: text.slice(0, 8000),
        });
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ============================================
  // memory — persistent key-value store (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_memory',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_memory',
        description: 'Read and write persistent memories that survive across sessions. Use to remember user preferences, project knowledge, and insights.',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['get', 'set', 'list', 'delete'], description: 'Memory operation' },
            namespace: { type: 'string', description: 'Memory category (e.g., "preference", "habit", "insight"). Default: "default"' },
            key: { type: 'string', description: 'Memory key (required for get/set/delete)' },
            value: { type: 'string', description: 'Memory value (required for set)' },
          },
          required: ['operation'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const store = new MemoryStore(db);
      const sessionId = context?.sessionId as string | undefined;
      const projectId = sessionId
        ? (db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(sessionId) as { project_id: string } | undefined)?.project_id ?? null
        : null;
      const namespace = (args.namespace as string) || 'default';

      switch (args.operation) {
        case 'get':
          if (!args.key) return JSON.stringify({ error: 'key is required for get' });
          return store.get(projectId, namespace, args.key as string) ?? JSON.stringify({ found: false });
        case 'set':
          if (!args.key || !args.value) return JSON.stringify({ error: 'key and value are required for set' });
          store.set(projectId, namespace, args.key as string, args.value as string);
          return JSON.stringify({ success: true, key: args.key, namespace });
        case 'list':
          return JSON.stringify(store.list(projectId, namespace));
        case 'delete':
          if (!args.key) return JSON.stringify({ error: 'key is required for delete' });
          return JSON.stringify({ deleted: store.delete(projectId, namespace, args.key as string) });
        default:
          return JSON.stringify({ error: `Unknown operation: ${args.operation}` });
      }
    },
  });
}
