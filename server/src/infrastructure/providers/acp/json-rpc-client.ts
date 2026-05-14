import { EventEmitter } from 'events';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { JsonRpcMessage, JsonRpcNotification, JsonRpcRequest } from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface ACPJsonRpcClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  process?: ChildProcessWithoutNullStreams;
}

export class ACPJsonRpcClient extends EventEmitter {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<string | number, PendingRequest>();
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(options: ACPJsonRpcClientOptions) {
    super();
    this.child = options.process ?? spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.handleChunk(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => this.emit('stderr', chunk));
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code, signal) => {
      this.failAll(new Error(`ACP agent exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      this.emit('exit', { code, signal });
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  async request<TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult> {
    const id = this.nextId++;
    const message: JsonRpcRequest<TParams> = { jsonrpc: '2.0', id, method, params };
    const result = new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
      });
    });
    this.write(message);
    return result;
  }

  notify<TParams = unknown>(method: string, params?: TParams): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  respond<TResult = unknown>(id: string | number, result: TResult): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondError(id: string | number, code: number, message: string, data?: unknown): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  close(): void {
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private write(message: JsonRpcMessage): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.emit('protocolError', error);
      return;
    }

    if ('id' in message && 'result' in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve(message.result);
      return;
    }

    if ('id' in message && 'error' in message) {
      if (message.id === null) {
        this.emit('protocolError', new Error(message.error.message));
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.reject(new Error(message.error.message));
      return;
    }

    if ('method' in message && 'id' in message) {
      this.emit('request', message);
      return;
    }

    if ('method' in message) {
      this.emit('notification', message);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
