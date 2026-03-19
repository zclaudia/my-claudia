/**
 * Lightweight MCP stdio client with auto-detecting framing.
 *
 * Supports both:
 *   - Content-Length framing (official MCP spec, used by Claude CLI)
 *   - Newline-delimited JSON (used by DevHelper, Kimi CLI, etc.)
 *
 * Framing is auto-detected from the first response bytes.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

// ── JSON-RPC types ──────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

// ── Command validation ─────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Validate that a command path is safe to execute.
 * Prevents directory traversal and ensures the path is absolute.
 */
function validateCommand(command: string): string {
  // Must be an absolute path or a simple command name (for PATH lookup)
  const isAbsolute = path.isAbsolute(command);
  const isSimpleName = /^[a-zA-Z0-9_-]+$/.test(command);

  if (!isAbsolute && !isSimpleName) {
    throw new Error(`Invalid MCP command: "${command}" must be an absolute path or simple command name`);
  }

  // For absolute paths, reject directory traversal components
  if (isAbsolute && command.split(path.sep).includes('..')) {
    throw new Error(`Invalid MCP command: path traversal detected in "${command}"`);
  }

  return command;
}

// ── McpClient ───────────────────────────────────────────────

export class McpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private readBuffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeoutId: NodeJS.Timeout }>();
  private connected = false;
  private framingMode: 'content-length' | 'newline' | null = null;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {
    // Validate command on construction
    validateCommand(command);
  }

  // ── Lifecycle ───────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) return;

    const mergedEnv = { ...process.env, ...this.env };
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
    });

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.pumpResponses();
    });

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) console.error(`[McpClient:${this.command}] ${text}`);
    });

    this.proc.on('exit', (code) => {
      this.connected = false;
      // Clear all pending requests and their timeouts
      for (const [, { reject, timeoutId }] of this.pending) {
        clearTimeout(timeoutId);
        reject(new Error(`MCP server exited with code ${code}`));
      }
      this.pending.clear();
      this.proc = null;
    });

    // Initialize handshake
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'claudia-mcp-client', version: '0.1.0' },
    }) as { protocolVersion?: string };

    // Send initialized notification
    this.sendNotification('notifications/initialized');
    this.connected = true;

    console.log(`[McpClient] Connected to ${this.command}, framing=${this.framingMode}, protocol=${result?.protocolVersion || 'unknown'}`);
  }

  async disconnect(): Promise<void> {
    if (!this.proc) return;
    this.connected = false;

    // Clear all pending requests and their timeouts
    for (const [, { reject, timeoutId }] of this.pending) {
      clearTimeout(timeoutId);
      reject(new Error('Client disconnecting'));
    }
    this.pending.clear();

    const proc = this.proc;
    this.proc = null;

    proc.stdin?.end();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve();
      }, 2000);
      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  // ── Public API ──────────────────────────────────────────

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request('tools/list', {}) as { tools?: McpToolDefinition[] };
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.request('tools/call', { name, arguments: args }) as McpToolResult;
    return result;
  }

  // ── Internal: Request/Response ──────────────────────────

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error('MCP server not running'));
        return;
      }

      const id = this.nextId++;

      // Create timeout and store its ID for cleanup
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeoutId });

      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.writeMessage(req);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return;
    const msg = { jsonrpc: '2.0' as const, method, ...(params ? { params } : {}) };
    this.writeMessage(msg);
  }

  // ── Internal: Framing (write) ───────────────────────────

  private writeMessage(message: object): void {
    const json = JSON.stringify(message);
    try {
      if (this.framingMode === 'content-length') {
        const body = Buffer.from(json, 'utf-8');
        const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
        this.proc!.stdin!.write(Buffer.concat([header, body]));
      } else {
        // Default to newline-delimited JSON (more widely compatible).
        // If server responds with Content-Length, we detect and switch on read.
        this.proc!.stdin!.write(json + '\n');
      }
    } catch {
      // stdin closed
    }
  }

  // ── Internal: Framing (read) ────────────────────────────

  private detectFraming(): void {
    if (this.framingMode !== null || this.readBuffer.length === 0) return;

    const firstChar = this.readBuffer.toString('utf-8').trimStart()[0];
    if (firstChar === '{') {
      this.framingMode = 'newline';
    } else {
      this.framingMode = 'content-length';
    }
  }

  private pumpResponses(): void {
    while (true) {
      const msg = this.parseNextMessage();
      if (msg === null) break;

      try {
        const response = JSON.parse(msg) as JsonRpcResponse;
        if (response.id != null) {
          const pending = this.pending.get(response.id as number);
          if (pending) {
            this.pending.delete(response.id as number);
            // Clear the timeout when response is received
            clearTimeout(pending.timeoutId);
            if (response.error) {
              pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch {
        // Ignore malformed responses
      }
    }
  }

  private parseNextMessage(): string | null {
    this.detectFraming();

    if (this.framingMode === 'newline') {
      return this.parseNewlineMessage();
    }
    return this.parseContentLengthMessage();
  }

  private parseNewlineMessage(): string | null {
    const newlineIdx = this.readBuffer.indexOf(0x0a); // \n
    if (newlineIdx === -1) return null;

    const line = this.readBuffer.subarray(0, newlineIdx).toString('utf-8').trim();
    this.readBuffer = this.readBuffer.subarray(newlineIdx + 1);

    if (!line) return this.parseNewlineMessage(); // skip empty lines
    return line;
  }

  private parseContentLengthMessage(): string | null {
    const separator = Buffer.from('\r\n\r\n');
    const headerEnd = this.readBuffer.indexOf(separator);
    if (headerEnd === -1) return null;

    const headerText = this.readBuffer.subarray(0, headerEnd).toString('utf-8');
    const contentLengthLine = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-length:'));

    if (!contentLengthLine) {
      this.readBuffer = this.readBuffer.subarray(headerEnd + separator.length);
      return null;
    }

    const contentLength = Number.parseInt(contentLengthLine.split(':')[1]?.trim() || '', 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      this.readBuffer = this.readBuffer.subarray(headerEnd + separator.length);
      return null;
    }

    const messageStart = headerEnd + separator.length;
    const messageEnd = messageStart + contentLength;
    if (this.readBuffer.length < messageEnd) return null;

    const body = this.readBuffer.subarray(messageStart, messageEnd).toString('utf-8');
    this.readBuffer = this.readBuffer.subarray(messageEnd);
    return body;
  }
}
