/**
 * Agent browser tool — lightweight URL fetcher with HTML-to-text extraction.
 * Phase 3: fetch + text extraction only (no Playwright).
 */

import { toolRegistry } from '../../../plugins/tool-registry.js';
import { isBlockedHostname } from './network-guard.js';

/** Simple HTML to text conversion (strip tags, decode entities) */
function htmlToText(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function registerBrowserTool(): void {
  toolRegistry.register({
    id: 'agent_browser',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_browser',
        description: 'Fetch a URL and return its text content. Useful for reading documentation, API responses, or web pages. Does not execute JavaScript.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            format: { type: 'string', enum: ['text', 'html', 'raw'], description: 'Output format: text (default, strips HTML), html (raw HTML), raw (for JSON/API responses)' },
          },
          required: ['url'],
        },
      },
    },
    handler: async (args) => {
      const urlStr = args.url as string;
      const format = (args.format as string) || 'text';

      try {
        const parsed = new URL(urlStr);
        if (await isBlockedHostname(parsed.hostname)) {
          return JSON.stringify({ error: 'Requests to private/internal addresses are blocked' });
        }

        const response = await fetch(urlStr, {
          headers: {
            'User-Agent': 'MyClaudia-Agent/1.0',
            'Accept': 'text/html, application/json, text/plain, */*',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          return JSON.stringify({ error: `HTTP ${response.status}: ${response.statusText}`, url: urlStr });
        }

        const body = await response.text();

        switch (format) {
          case 'html':
            return JSON.stringify({ url: urlStr, content: body.slice(0, 16000) });
          case 'raw':
            return body.slice(0, 16000);
          case 'text':
          default:
            return JSON.stringify({ url: urlStr, content: htmlToText(body).slice(0, 8000) });
        }
      } catch (err: any) {
        return JSON.stringify({ error: err.message, url: urlStr });
      }
    },
  });
}
