import type { Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { fixView, type FixView } from './fix';
import { freeFixes } from './free-fixes';
import { sectionFixes } from './segment/fixes';
import { edited, FIRST_AUDIT } from './segment/test-helpers';
import { holds } from '../../../__tests__/v2/_lib/holds';

const BAD = FIRST_AUDIT['bad-site'];
const fixOf = (n: number) =>
  fixture('bad-site').fixes.find(
    (f) => f.number === n && f.site_id === '50000000-0000-4000-8000-000000000001',
  )!;
const view = (n: number, opts = {}) =>
  fixView(fixture('bad-site'), BAD, fixOf(n).id, { asFirstSeen: true, ...opts });
const fix2 = (d: ReturnType<typeof fixture>) => d.fixes.find((f) => f.id === fixOf(2).id)!;
const open = (v: FixView) => {
  if (v.kind !== 'open' || !v.packet)
    throw new Error(`expected an open fix with a packet, got ${v.kind}`);
  return { ...v, packet: v.packet };
};

/** Every string a packet holds, so a test can say none of them reached a view. */
const packetStrings = (f: Fix) =>
  f.packet
    ? [
        ...f.packet.context,
        ...f.packet.change,
        ...f.packet.keep,
        f.packet.verify.command,
        f.packet.verify.expect,
      ]
    : [];

describe('fixView: the fix the locked screen shows (fix 2 of the bad site’s first audit)', () => {
  const v = open(view(2));

  it('places the fix in its audit: the section, its number among the live fixes, the expiry', () => {
    expect(v.frame.domain).toBe('example-outfitter.com');
    expect(v.frame.section.title).toBe('Readable without JavaScript');
    // FACTS I10: the fixture has 13 live fixes at this audit, not the lock's 14 (Web Bot Auth left).
    expect(v.frame.position).toBe('Fix 2 of 13');
    expect(v.frame.keptUntil).toBe('26 Oct, 02:34 UTC');
    expect(v.frame.tabs.filter((t) => t.current).map((t) => t.label)).toEqual([
      'Without JavaScript',
    ]);
  });

  it('heads with the title, the estimated effect and the class, from the fix’s own fields', () => {
    expect(v.head.title).toBe('Server-render the product template.');
    expect([v.head.points, v.head.unit]).toEqual(['+22', 'AI readability, estimated']);
    expect(v.head.recommendation).toEqual({
      cls: 'documented_requirement',
      label: 'documented platform requirement',
    });
  });

  it('shows the tiles from the affected pages, the text share before and after, and the effort', () => {
    expect(v.head.tiles).toEqual([
      { label: 'Pages affected', value: '158', note: null },
      { label: 'Text today', value: '12%', note: null },
      { label: 'Text after, estimated', value: '≥ 90%', note: null },
      { label: 'Effort', value: 'one template, one deploy', note: null },
    ]);
  });

  it('shows the before and after rows, bounded as the contract bounds them', () => {
    expect(v.beforeAfter!.rows).toEqual([
      { label: 'Words without JavaScript', today: '134', after: '≈ 1,100' },
      { label: 'AI crawlers that read the text', today: '0 of 6', after: '4 of 6*' },
      { label: 'Quotable opening', today: 'no', after: 'no, until the Content fixes' },
    ]);
    // Fix 1 lets the other two AI crawlers in: 4 + 2 of the 6 tested.
    expect(v.beforeAfter!.footnote).toBe('* 6 of 6 once fix 1 in Crawler access is also fixed.');
  });

  it('writes the packet with its headings, the verify command, its crawler and what to expect', () => {
    const f = fixOf(2);
    expect(v.packet.block.split('\n')[0]).toBe('Context');
    for (const line of [...f.packet!.change, ...f.packet!.keep])
      expect(v.packet.block).toContain(line);
    expect(v.packet.block).toContain(`  ${f.packet!.verify.command}`);
    expect(v.packet.block).toContain(`    → expect ${f.packet!.verify.expect}`);
    expect(v.packet.block).toContain(
      '# we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string',
    );
    expect(v.packet.block).toContain('Requests as OAI-SearchBot, which gets 200 today.');
    expect(v.packet.block).toContain('We run this on all 158 pages when you mark the fix done.');
    expect(v.packet.stack).toBe(
      'Written for your stack as detected: Next.js 14, pages router, Shopify as the product backend. Copy it as a prompt or hand it to a developer.',
    );
  });

  it('copies the same prompt the segment’s open fix copies', () => {
    const d = fixture('bad-site');
    const segment = sectionFixes(d, findCheck(d, BAD), 'without_js').open[0]!;
    expect(v.packet.prompt).toBe(segment.prompt);
    expect(v.packet.download).toBe('fix-2-server-render-the-product-template.md');
  });

  it('offers the packet’s frameworks in the switch, and says which have no packet yet', () => {
    expect(v.switcher!.options.map((o) => [o.key, o.label, o.current])).toEqual([
      ['nextjs', 'Next.js', true],
      ['shopify_liquid', 'Shopify (Liquid)', false],
      ['shopify_hydrogen', 'Shopify (Hydrogen)', false],
      ['wordpress', 'WordPress', false],
      ['webflow', 'Webflow', false],
      ['generic', 'Other', false],
    ]);
    expect(v.switcher!.heading).toBe('Not on Next.js?');
    expect(v.switcher!.detected).toBe(
      'The audit detected Next.js from the asset paths and Shopify from the product API calls.',
    );
    expect(v.switcher!.options.find((o) => o.key === 'webflow')!.note).toBe(
      'The audit has no packet for Webflow yet. The packet above is written for Next.js.',
    );
  });

  it('links back to its section and on to the next fix in order, with its effect', () => {
    expect(v.frame.back.label).toBe('Back: Without JavaScript');
    expect(v.frame.next).toEqual({
      label: 'Next fix: Link the 7 orphan pages from their collections · +4 SEO',
      href: '#',
    });
  });

  it('builds a fix page’s links from the hrefs it is given', () => {
    const w = view(2, {
      hrefs: { overview: '/o', segment: (k: string) => `/s/${k}`, fix: (id: string) => `/f/${id}` },
    });
    expect(w.frame.section.href).toBe('/s/nojs');
    expect(w.frame.back.href).toBe('/s/nojs');
    expect(w.frame.next!.href).toBe(`/f/${fixOf(3).id}`);
  });
});

describe('fixView: the Pro wall', () => {
  it('opens a free fix on Free, and every live fix on Pro', () => {
    const d = fixture('bad-site');
    const check = findCheck(d, BAD);
    const free = new Set(freeFixes(d, check).map((f) => f.id));
    for (const f of fixesAsOf(d, check)) {
      expect(fixView(d, BAD, f.id).kind).toBe(free.has(f.id) ? 'open' : 'locked');
      expect(fixView(d, BAD, f.id, { plan: 'pro' }).kind).toBe('open');
    }
  });

  it('carries none of a locked fix’s packet, in any field, however it is escaped', () => {
    const v = view(5);
    expect(v.kind).toBe('locked');
    const json = JSON.stringify(v);
    const lines = packetStrings(fixOf(5));
    // Two of its lines hold quotes, which JSON escapes: the check must see through that.
    expect(lines.some((l) => /["']/.test(l))).toBe(true);
    for (const s of lines) expect(holds(json, s), s).toBe(false);
    // The control: the open fix's view holds its own packet, found the same way.
    const own = JSON.stringify(view(2));
    for (const s of packetStrings(fixOf(2))) expect(holds(own, s), s).toBe(true);
  });

  it('asks nothing it cannot answer on a kept audit: no keep bar, so no ask to open one', () => {
    const v = view(5, { asFirstSeen: false });
    if (v.kind !== 'locked') throw new Error(v.kind);
    expect(v.keep).toBeNull();
    expect(v.wall.action).toBeNull();
    expect(v.wall.body).toContain('Pro opens every fix, with its packet.');
    expect(v.wall.body).not.toContain('Keeping this audit');
    const free = open(view(2, { asFirstSeen: false }));
    expect(free.shipped).toBeNull();
  });

  it('names the first fixes in the audit’s order, not by an effect the rule does not measure', () => {
    const v = view(5);
    if (v.kind !== 'locked') throw new Error(v.kind);
    expect(v.wall.body).toContain('Free opens the first three fixes in this audit’s order.');
    expect(v.wall.action).toEqual({ label: 'See this fix with Pro', href: '#keep' });
  });

  it('never reads a locked fix’s packet', () => {
    const { d } = edited('bad-site');
    const f = d.fixes.find((x) => x.id === fixOf(5).id)!;
    Object.defineProperty(f, 'packet', {
      get: () => {
        throw new Error('the packet of a locked fix was read');
      },
      enumerable: true,
    });
    expect(() => fixView(d, BAD, f.id, { asFirstSeen: true })).not.toThrow();
  });

  it('still shows a locked fix’s verdict: the effect, the class and the pages (it records no effort)', () => {
    const v = view(5);
    expect([v.head.points, v.head.unit]).toEqual(['+2', 'Technical SEO, estimated']);
    expect(v.head.recommendation.label).toBe('supported best practice');
    expect(v.head.tiles.map((t) => t.label)).toEqual(['Pages affected']);
  });
});

describe('fixView: what the packet says it is written for, and where the fix stands', () => {
  it('says "your stack" only when the audit detected the packet’s framework', () => {
    const { d } = edited('bad-site');
    fix2(d).packet!.framework = 'webflow';
    const v = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
    expect(v.packet.stack).toBe(
      'Written for Webflow; the audit detected Next.js 14, pages router, Shopify as the product backend. Copy it as a prompt or hand it to a developer.',
    );
  });

  it('does not call a Shopify front-end packet “your stack” behind a detected Next.js front end', () => {
    for (const fw of ['shopify_liquid', 'shopify_hydrogen'] as const) {
      const { d } = edited('bad-site');
      fix2(d).packet!.framework = fw;
      const v = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
      expect(v.packet.stack, fw).toMatch(
        /^Written for Shopify \((Liquid|Hydrogen)\); the audit detected /,
      );
    }
  });

  it('names the switch’s “Other” as other front ends', () => {
    const v = open(view(2));
    expect(v.switcher!.options.find((o) => o.key === 'generic')!.note).toBe(
      'The audit has no packet for other front ends yet. The packet above is written for Next.js.',
    );
  });

  it('gives the fix’s place in the order beside its number when the two differ', () => {
    expect(view(5).frame.position).toBe('Fix 5 · 4 of 13');
    expect(view(3).frame.position).toBe('Fix 3 of 13');
  });
});

describe('fixView: other fixtures and states', () => {
  it('writes a packet with no detected front end as written for any stack', () => {
    const d = fixture('challenged-site');
    const check = findCheck(d, FIRST_AUDIT['challenged-site']);
    const [first] = fixesAsOf(d, check);
    const v = open(fixView(d, check.id, first!.id));
    expect(v.packet.stack).toBe(
      'Written for any stack. Copy it as a prompt or hand it to a developer.',
    );
    expect(v.switcher).toBeNull();
    expect(v.beforeAfter).toBeNull();
    // Its check re-checks the site rather than making a request, so it names no crawler it requests as.
    expect(v.packet.block).not.toContain('Requests as');
  });

  it('shows a fix the check verified resolved, with no packet and the day it was verified', () => {
    const d = fixture('bad-site');
    const f = d.fixes.find((x) => x.status === 'verified_resolved')!;
    const v = fixView(d, 'c0000000-0000-4000-8000-00000000000c', f.id);
    expect(v.kind).toBe('resolved');
    if (v.kind !== 'resolved') return;
    expect(v.frame.position).toBe('Fix 1, resolved');
    expect(v.resolved).toBe('Verified resolved by the check of 30 Oct, 10:01 UTC.');
  });

  it('opens a free fix that has no packet, and says no packet was written', () => {
    const d = fixture('bad-site');
    const f = d.fixes.find((x) => x.status === 'verified_resolved')!;
    const v = fixView(d, 'c0000000-0000-4000-8000-00000000000b', f.id);
    expect(v.kind).toBe('open');
    if (v.kind === 'open') expect(v.packet).toBeNull();
  });

  it('refuses a fix of another site, and one the check has not seen yet', () => {
    const d = fixture('bad-site');
    const other = d.fixes.find((x) => x.status === 'verified_resolved')!;
    expect(() => fixView(d, BAD, other.id)).toThrow(/another site/);
    expect(() => fixView(d, BAD, fixOf(0).id)).toThrow(/not seen/);
  });
});
