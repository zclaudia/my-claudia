import { describe, expect, it } from 'vitest';
import {
  createRequest,
  isEvent,
  isRequest,
  isResponse,
  isStreamMessage,
} from './correlation.js';

describe('correlation guards', () => {
  it('does not classify a request as an event', () => {
    const request = createRequest('session.open.request', { sessionId: 's1' });

    expect(isRequest(request)).toBe(true);
    expect(isEvent(request)).toBe(false);
  });

  it('keeps response and stream guards mutually exclusive from events', () => {
    const response = {
      id: 'resp-1',
      type: 'session.open.response',
      payload: { ok: true },
      timestamp: Date.now(),
      metadata: {
        requestId: 'req-1',
        success: true,
      },
    };

    const stream = {
      id: 'stream-1',
      type: 'session.open.stream',
      payload: { chunk: 1 },
      timestamp: Date.now(),
      metadata: {
        requestId: 'req-1',
        sequence: 1,
        final: false,
      },
    };

    expect(isResponse(response)).toBe(true);
    expect(isEvent(response)).toBe(false);
    expect(isStreamMessage(stream)).toBe(true);
    expect(isEvent(stream)).toBe(false);
  });
});
