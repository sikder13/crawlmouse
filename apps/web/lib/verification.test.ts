/** The meta-tag check, as `/bot` describes it: our earlier name on the homepage, no From header. */
import { describe, expect, it, vi } from 'vitest';

const safeFetch = vi.hoisted(() => vi.fn(async () => ({ status: 200, body: '' })));
vi.mock('server-only', () => ({}));
vi.mock('@crawlmouse/engine', () => ({ safeFetch }));

import { checkMetaTag } from './verification';

describe('checkMetaTag', () => {
  it('requests the homepage as CrawlmouseBot, with no headers of its own', async () => {
    await checkMetaTag('example.com', 'token');
    expect(safeFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = safeFetch.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe('https://example.com/');
    expect(String(opts.userAgent).startsWith('CrawlmouseBot')).toBe(true);
    expect(opts).not.toHaveProperty('headers');
  });
});
