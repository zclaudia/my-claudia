import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../plugins/index.js';
import { isBlockedHostname } from '../network-guard.js';

vi.mock('../network-guard.js', () => ({
  isBlockedHostname: vi.fn(),
}));

describe('agent-tools/browser', () => {
  beforeEach(() => {
    toolRegistry.clear();
    vi.clearAllMocks();
  });

  it('registers the browser tool and blocks private destinations before fetching', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(isBlockedHostname).mockResolvedValue(true);

    const { registerBrowserTool } = await import('../browser.js');
    registerBrowserTool();

    const tool = toolRegistry.get('agent_browser');
    expect(tool).toBeDefined();

    const result = await tool!.handler({ url: 'http://internal.example.local' });

    expect(isBlockedHostname).toHaveBeenCalledWith('internal.example.local');
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(result)).toEqual({
      error: 'Requests to private/internal addresses are blocked',
    });
  });

  it('fetches pages with redirect blocking and returns extracted text by default', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<h1>Hello</h1><script>bad()</script><p>World &amp; Friends</p>'),
    }));

    const { registerBrowserTool } = await import('../browser.js');
    registerBrowserTool();

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://example.com/docs' });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          'User-Agent': 'MyClaudia-Agent/1.0',
        }),
      }),
    );
    expect(JSON.parse(result)).toEqual({
      url: 'https://example.com/docs',
      content: 'Hello\n\nWorld & Friends',
    });
  });

  it('returns raw bodies unchanged when format=raw', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"ok":true}'),
    }));

    const { registerBrowserTool } = await import('../browser.js');
    registerBrowserTool();

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://api.example.com/status', format: 'raw' });

    expect(result).toBe('{"ok":true}');
  });

  it('returns HTTP errors in a structured payload', async () => {
    vi.mocked(isBlockedHostname).mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: vi.fn(),
    }));

    const { registerBrowserTool } = await import('../browser.js');
    registerBrowserTool();

    const tool = toolRegistry.get('agent_browser');
    const result = await tool!.handler({ url: 'https://example.com/rate-limited' });

    expect(JSON.parse(result)).toEqual({
      error: 'HTTP 429: Too Many Requests',
      url: 'https://example.com/rate-limited',
    });
  });
});
