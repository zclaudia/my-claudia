import { describe, expect, it } from 'vitest';
import { isIgnorableProcessError } from '../process-error-filter.js';

describe('isIgnorableProcessError', () => {
  it('matches broken pipe socket write errors', () => {
    const error = Object.assign(new Error('write EPIPE'), {
      code: 'EPIPE',
      stack: [
        'Error: write EPIPE',
        '    at WriteWrap.onWriteComplete (node:internal/stream_base_commons:87:19)',
        'Emitted \'error\' event on Socket instance at:',
        '    at emitErrorNT (node:internal/streams/destroy:170:8)',
      ].join('\n'),
    });

    expect(isIgnorableProcessError(error)).toBe(true);
  });

  it('matches connection reset socket errors', () => {
    const error = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      stack: 'Error: socket hang up\n    at Socket.socketOnEnd (node:_http_client:542:25)',
    });

    expect(isIgnorableProcessError(error)).toBe(true);
  });

  it('does not match unrelated errors', () => {
    const error = Object.assign(new Error('SQLITE_BUSY: database is locked'), {
      code: 'SQLITE_BUSY',
    });

    expect(isIgnorableProcessError(error)).toBe(false);
  });

  it('does not match generic epipe errors without socket context', () => {
    const error = Object.assign(new Error('write EPIPE'), {
      code: 'EPIPE',
      stack: 'Error: write EPIPE\n    at someApplicationCode (/tmp/app.js:1:1)',
    });

    expect(isIgnorableProcessError(error)).toBe(false);
  });
});
