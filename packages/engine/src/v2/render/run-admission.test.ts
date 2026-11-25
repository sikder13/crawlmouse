import { describe, expect, it, vi } from 'vitest';

// QA's F1 on #150: production's render runs on the engine's own admission (`defaultAdmit`), and
// only a comment said so. These hold it to that in code: a render given no `admit` refuses a page
// whose host resolves to a private address, through a stub resolver standing in for DNS, and renders
// the same page when the name resolves to a public one.

const dns = vi.hoisted(() => ({ address: '10.0.0.5', asked: [] as string[] }));
vi.mock('node:dns', async (original) => {
  const real = await original<typeof import('node:dns')>();
  return {
    ...real,
    promises: {
      ...real.promises,
      lookup: async (host: string) => {
        dns.asked.push(host);
        return [{ address: dns.address, family: dns.address.includes(':') ? 6 : 4 }];
      },
    },
  };
});

import { fakeClient, memoryDailyBudget, replyFixtures } from './fakes.js';
import { renderCheck, type RenderCheckInput } from './run.js';

const FIXTURES = replyFixtures();
const page = FIXTURES.get('server-rendered')!;

/** A render of one page with no `admit`: the engine's default decides. */
function withDefaultAdmission(client = fakeClient(FIXTURES.values())): RenderCheckInput {
  return {
    candidates: [
      {
        url: page.url,
        template_key: '/guide',
        kind: 'content',
        status_code: 200,
        is_html: true,
        pagerank_share: 1,
        fetched_under_our_robots: true,
      },
    ],
    openFixTemplates: [],
    maxRenders: 1,
    previousStates: new Map(),
    client,
    caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
    daily: memoryDailyBudget(),
    sleep: async () => {},
  };
}

describe('a render given no admit uses the engine’s SSRF admission (QA F1 on #150)', () => {
  it.each(['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1'])(
    'refuses a page whose host resolves to %s, and sends Browser Run nothing',
    async (address) => {
      dns.address = address;
      dns.asked.length = 0;
      const client = fakeClient(FIXTURES.values());
      const out = await renderCheck(withDefaultAdmission(client));
      expect(dns.asked).toEqual([new URL(page.url).hostname]);
      expect(client.calls).toEqual([]);
      expect(out.pages[0]).toMatchObject({
        rendered: false,
        reason: 'not_admitted',
        detail: 'resolution',
      });
    },
  );

  it('renders the same page when its host resolves to a public address', async () => {
    dns.address = '93.184.216.34';
    const client = fakeClient(FIXTURES.values());
    const out = await renderCheck(withDefaultAdmission(client));
    expect(client.calls.length).toBe(2);
    expect(out.pages[0]).toMatchObject({ rendered: true });
  });
});
