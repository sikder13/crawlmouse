import type { Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { fixView, type FixView } from './fix';
import { freeFixes } from './free-fixes';
import { noPacketLine } from './no-packet';
import { noPacketReason } from './packet-reason';
import { packetBodies, packetPrompt, sectionFixes, type PacketFramework } from './segment/fixes';
import { edited, FIRST_AUDIT } from './segment/test-helpers';
import {
  bodyFor,
  everyPacketString,
  parsed,
  seeFor,
  withBodies,
  withSee,
} from './test-support/multi-body';
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
  // `own` is the body of the packet's own framework: the one the page opens with.
  return { ...v, packet: v.packet, own: v.packet.bodies[0]! };
};

/** Every string of every body a packet holds, so a test can say none of them reached a view. */
const packetStrings = (f: Fix) => (f.packet ? everyPacketString(f.packet) : []);

/**
 * The bad site with fix `n` given a body for each of `others`, and that fix's view; with `see`,
 * each body has a readable command too.
 */
function withBodiesOn(
  n: number,
  others: readonly PacketFramework[],
  { see = false, ...opts }: { see?: boolean; plan?: 'free' | 'pro' } = {},
) {
  const { d } = edited('bad-site');
  const f = d.fixes.find((x) => x.id === fixOf(n).id)!;
  const packet = withBodies(f.packet!, others);
  f.packet = parsed({ ...f, packet: see ? withSee(packet) : packet }).packet;
  return { f, v: fixView(d, BAD, f.id, { asFirstSeen: true, ...opts }) };
}

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

  it('marks an approximate count of crawlers as one, as it does the words', () => {
    const { d } = edited('bad-site');
    const crawlers = fix2(d).before_after.find((r) => r.measure === 'crawlers_reading_text')!;
    crawlers.after_bound = 'approx';
    const w = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
    expect(w.beforeAfter!.rows[1]).toEqual({
      label: 'AI crawlers that read the text',
      today: '0 of 6',
      after: '≈ 4 of 6*',
    });
  });

  it('writes the packet with its headings, the verify command, its crawler and what to expect', () => {
    const f = fixOf(2);
    expect(v.own.block.split('\n')[0]).toBe('Context');
    for (const line of [...f.packet!.change, ...f.packet!.keep])
      expect(v.own.block).toContain(line);
    expect(v.own.block).toContain(`  ${f.packet!.verify.command}`);
    expect(v.own.block).toContain(`    → expect ${f.packet!.verify.expect}`);
    expect(v.own.block).toContain(
      '# we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string',
    );
    expect(v.own.block).toContain('Requests as OAI-SearchBot, which gets 200 today.');
    expect(v.own.block).toContain('We run this on all 158 pages when you mark the fix done.');
    expect(v.own.stack).toBe(
      'Written for your stack as detected: Next.js 14, pages router, Shopify as the product backend. Copy it as a prompt or hand it to a developer.',
    );
  });

  it('copies the same prompt the segment’s open fix copies', () => {
    const d = fixture('bad-site');
    const segment = sectionFixes(d, findCheck(d, BAD), 'without_js').open[0]!;
    expect(v.own.prompt).toBe(segment.prompt);
    expect(v.packet.download).toBe('fix-2-server-render-the-product-template.md');
  });

  it('has no switch: the fixture lists six frameworks for this packet and holds one body', () => {
    const p = fixOf(2).packet!;
    expect([p.frameworks.length, p.packets.length]).toEqual([6, 0]);
    expect(v.packet.bodies.map((b) => [b.key, b.label])).toEqual([['nextjs', 'Next.js']]);
    expect(v.switcher).toBeNull();
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

  it('carries no body of a locked fix that holds several, while the same fix opened carries each', () => {
    const others = ['wordpress', 'generic'] as const;
    const { f, v } = withBodiesOn(5, others);
    expect(v.kind).toBe('locked');
    const json = JSON.stringify(v);
    const lines = packetStrings(f);
    // The fixture's own body, and the six strings of each hand-made one.
    expect(lines).toHaveLength(packetStrings(fixOf(5)).length + others.length * 6);
    for (const s of lines) expect(holds(json, s), s).toBe(false);
    // The control: on Pro the same fix opens, and its view holds each body, found the same way.
    const opened = JSON.stringify(withBodiesOn(5, others, { plan: 'pro' }).v);
    for (const s of lines) expect(holds(opened, s), s).toBe(true);
  });

  it('carries none of a locked fix’s readable command: not it, nor what it prints today or after', () => {
    const others = ['wordpress', 'generic'] as const;
    const { f, v } = withBodiesOn(5, others, { see: true });
    expect(v.kind).toBe('locked');
    const json = JSON.stringify(v);
    const lines = packetStrings(f);
    // Three more strings for each of the three bodies: the command, today, after the fix.
    expect(lines).toHaveLength(packetStrings(fixOf(5)).length + others.length * 6 + 3 * 3);
    for (const framework of ['nextjs', ...others] as const) {
      const see = seeFor(framework);
      for (const s of [see.command, see.today, see.after]) {
        expect(lines, s).toContain(s);
        expect(holds(json, s), s).toBe(false);
      }
    }
    for (const s of lines) expect(holds(json, s), s).toBe(false);
    // The control: on Pro the same fix opens, and its view holds each of them, found the same way.
    const opened = JSON.stringify(withBodiesOn(5, others, { see: true, plan: 'pro' }).v);
    for (const s of lines) expect(holds(opened, s), s).toBe(true);
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

describe('fixView: the framework switch reads the packet’s bodies', () => {
  const { f, v: view3 } = withBodiesOn(2, ['wordpress', 'generic']);
  const v = open(view3);

  it('holds one body per framework written, the packet’s own first, and offers exactly those', () => {
    expect(v.packet.bodies.map((b) => [b.key, b.label])).toEqual([
      ['nextjs', 'Next.js'],
      ['wordpress', 'WordPress'],
      ['generic', 'Other'],
    ]);
    expect(v.switcher!.options).toEqual(v.packet.bodies.map(({ key, label }) => ({ key, label })));
    expect(v.switcher!.heading).toBe('Not on Next.js?');
    expect(v.switcher!.detected).toBe(
      'The audit detected Next.js from the asset paths and Shopify from the product API calls.',
    );
  });

  it('builds each body’s block and prompt from that body, and from no other', () => {
    const written = packetBodies(f.packet!);
    expect(written.map((b) => b.framework)).toEqual(['nextjs', 'wordpress', 'generic']);
    v.packet.bodies.forEach((body, i) => {
      const own = written[i]!;
      for (const line of [...own.context, ...own.change, ...own.keep, own.verify.command]) {
        expect(body.block, `${body.key} block`).toContain(line);
        expect(body.prompt, `${body.key} prompt`).toContain(line);
      }
      expect(body.prompt).toBe(packetPrompt(f, own));
      for (const other of written.filter((b) => b !== own)) {
        for (const line of [...other.change, other.verify.command]) {
          expect(body.block, `${body.key} block`).not.toContain(line);
          expect(body.prompt, `${body.key} prompt`).not.toContain(line);
        }
      }
    });
    // Independently of packetBodies: the second body's prompt is the hand-made WordPress body's.
    expect(v.packet.bodies[1]!.prompt.split('\n')).toEqual([
      `The audit’s title for this fix: "${f.title}"`,
      '',
      ...bodyFor('wordpress').context,
      '',
      'Change:',
      ...bodyFor('wordpress').change,
      '',
      'Keep:',
      ...bodyFor('wordpress').keep,
      '',
      'Verify (we run this after you mark done):',
      `  ${bodyFor('wordpress').verify.command}`,
      `  → expect ${bodyFor('wordpress').verify.expect}`,
    ]);
  });

  it('does not offer a framework the packet lists without a body', () => {
    const { d } = edited('bad-site');
    const p = fix2(d).packet!;
    // The fixture's shape, with one body added: six frameworks listed, two bodies held.
    p.packets = [bodyFor('webflow')];
    expect(p.frameworks).toHaveLength(6);
    const w = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
    expect(w.switcher!.options.map((o) => o.key)).toEqual(['nextjs', 'webflow']);
    expect(w.packet.bodies.map((b) => b.key)).toEqual(['nextjs', 'webflow']);
  });

  it('heads the switch “Choose your stack” when the packet’s own body is for any stack', () => {
    const { d, check } = edited('bad-site');
    check.stack = null;
    const p = fix2(d).packet!;
    Object.assign(p, withBodies({ ...p, framework: 'generic' }, ['nextjs', 'wordpress']));
    const w = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
    expect(w.switcher!.heading).toBe('Choose your stack');
    expect(w.switcher!.detected).toBe('The audit did not detect this site’s stack.');
    expect(w.switcher!.options.map((o) => o.label)).toEqual(['Other', 'Next.js', 'WordPress']);
  });
});

describe('fixView: which stack a body says it is written for', () => {
  const TAIL = ' Copy it as a prompt or hand it to a developer.';
  const NEXT = 'Next.js 14, pages router, Shopify as the product backend';
  /** Fix 2 of the bad site with its packet and its check edited, opened. */
  const fix2With = (
    framework: PacketFramework,
    others: readonly PacketFramework[],
    stack?: (s: NonNullable<ReturnType<typeof edited>['check']['stack']>) => unknown,
  ) => {
    const { d, check } = edited('bad-site');
    const p = fix2(d).packet!;
    Object.assign(p, withBodies({ ...p, framework }, others));
    if (stack) check.stack = stack(check.stack!) as typeof check.stack;
    return open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
  };
  const NONE = { frontend: null, backend: null, edge: null };

  it('a detected front end that has a body: your stack as detected', () => {
    expect(open(view(2)).own.stack).toBe(`Written for your stack as detected: ${NEXT}.${TAIL}`);
  });

  it('the CMS is the framework (no front end detected): your stack as detected', () => {
    for (const cms of ['wordpress', 'webflow'] as const) {
      const v = fix2With(cms, [], () => ({
        ...NONE,
        backend: { cms, detected_from: 'the asset paths' },
      }));
      const name = cms === 'wordpress' ? 'WordPress' : 'Webflow';
      expect(v.own.stack).toBe(`Written for your stack as detected: ${name}.${TAIL}`);
    }
  });

  it('nothing detected: written for any stack, the audit did not detect yours, choose it', () => {
    for (const stack of [() => null, () => NONE]) {
      const v = fix2With('generic', ['nextjs'], stack);
      expect(v.own.stack).toBe(
        `Written for any stack: the audit did not detect yours. If yours is listed under “Choose your stack”, choose it.${TAIL}`,
      );
    }
    // With one body there is no switch to point to.
    expect(fix2With('generic', [], () => null).own.stack).toBe(
      `Written for any stack: the audit did not detect yours.${TAIL}`,
    );
  });

  it('a CMS that names no framework (Shopify, front end unknown): says what was detected', () => {
    const v = fix2With('generic', ['shopify_liquid', 'shopify_hydrogen'], () => ({
      ...NONE,
      backend: { cms: 'shopify', detected_from: 'the theme asset paths' },
    }));
    expect(v.own.stack).toBe(
      `Written for any stack: the audit detected Shopify, not which front end the site runs. If yours is listed under “Choose your stack”, choose it.${TAIL}`,
    );
  });

  it('a detected front end the packets name no framework for: says it has no steps of its own', () => {
    const v = fix2With('generic', ['nextjs'], (s) => ({
      ...s,
      frontend: { ...s.frontend!, name: 'Nuxt', framework: 'generic', version: '3', router: null },
    }));
    expect(v.own.stack).toBe(
      `Written for any stack; the audit detected Nuxt 3, Shopify as the product backend, which has no steps of its own. If yours is listed under “Choose your stack”, choose it.${TAIL}`,
    );
  });

  it('the detected stack has no body: any stack, and the audit says which stack it detected', () => {
    const v = fix2With('generic', ['wordpress']);
    expect(v.own.stack).toBe(
      `Written for any stack; the audit detected ${NEXT} and has no steps specific to it for this fix.${TAIL}`,
    );
    // The challenged site as the fixture holds it: WordPress detected, one body, for any stack.
    const d = fixture('challenged-site');
    const check = findCheck(d, FIRST_AUDIT['challenged-site']);
    const c = open(fixView(d, check.id, fixesAsOf(d, check)[0]!.id));
    expect(c.own.stack).toBe(
      `Written for any stack; the audit detected WordPress and has no steps specific to it for this fix.${TAIL}`,
    );
  });

  it('a body chosen in the switch names its framework and what the audit detected', () => {
    const v = fix2With('nextjs', ['wordpress', 'generic']);
    expect(v.packet.bodies.map((b) => b.stack)).toEqual([
      `Written for your stack as detected: ${NEXT}.${TAIL}`,
      `Written for WordPress; the audit detected ${NEXT}.${TAIL}`,
      `Written for any stack.${TAIL}`,
    ]);
  });

  it('says "your stack" only when the audit detected the packet’s framework', () => {
    expect(fix2With('webflow', []).own.stack).toBe(
      `Written for Webflow; the audit detected ${NEXT}.${TAIL}`,
    );
  });

  it('does not call a Shopify front-end packet “your stack” behind a detected Next.js front end', () => {
    for (const fw of ['shopify_liquid', 'shopify_hydrogen'] as const) {
      expect(fix2With(fw, []).own.stack, fw).toMatch(
        /^Written for Shopify \((Liquid|Hydrogen)\); the audit detected /,
      );
    }
  });

  it('matches the front end by its framework, not by its name', () => {
    // Named Hydrogen, framework Next.js: a Hydrogen packet is not this stack's.
    const named = fix2With('shopify_hydrogen', [], (s) => ({
      ...s,
      frontend: { ...s.frontend!, name: 'Hydrogen' },
    }));
    expect(named.own.stack).toMatch(
      /^Written for Shopify \(Hydrogen\); the audit detected Hydrogen 14/,
    );
    // Framework Hydrogen under another spelling of the name: it is.
    const framework = fix2With('shopify_hydrogen', [], (s) => ({
      ...s,
      frontend: { ...s.frontend!, name: 'Shopify Hydrogen', framework: 'shopify_hydrogen' },
    }));
    expect(framework.own.stack).toMatch(
      /^Written for your stack as detected: Shopify Hydrogen 14, pages router, /,
    );
  });

  it('does not call a Liquid packet “your stack” from the CMS alone: Shopify does not say which front end', () => {
    const v = fix2With('shopify_liquid', [], (s) => ({ ...s, frontend: null }));
    expect(v.own.stack).toBe(`Written for Shopify (Liquid); the audit detected Shopify.${TAIL}`);
  });
});

describe('fixView: the verify block', () => {
  const COMMENT = '# we run the same request with a tagged user agent';
  const blockOf = (command: string, ua: string | null) => {
    const { d } = edited('bad-site');
    Object.assign(fix2(d).packet!.verify, { command, ua });
    return open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true })).own.block;
  };

  it('names the crawler of a command that requests as one, whatever the command’s first word', () => {
    for (const command of [
      'curl -sA "OAI-SearchBot" https://example-outfitter.com/products/ridge-2p | grep -c "three-season"',
      'test "$(curl -s -A "OAI-SearchBot" https://example-outfitter.com/products/ridge-2p | grep -c three-season)" -ge 1',
    ]) {
      const block = blockOf(command, 'OAI-SearchBot');
      expect(block).toContain(COMMENT);
      expect(block).toContain('Requests as OAI-SearchBot, which gets 200 today.');
    }
  });

  it('names no crawler for a command that requests as none, a curl among them', () => {
    for (const command of [
      'curl -s https://example-outfitter.com/robots.txt | grep -c "Claude-SearchBot"',
      'test "$(curl -s https://example-outfitter.com/ | grep -c canonical)" -eq 1',
    ]) {
      const block = blockOf(command, null);
      expect(block).not.toContain(COMMENT);
      expect(block).not.toContain('Requests as');
    }
  });

  it('says the request’s twin and no status for a crawler the check holds no row for', () => {
    const block = blockOf('curl -sA "NoSuchBot" https://example-outfitter.com/', 'NoSuchBot');
    expect(block).toContain(COMMENT);
    expect(block).not.toContain('Requests as');
  });
});

describe('fixView: the two verify layers of a body with a readable command', () => {
  const others = ['wordpress', 'generic'] as const;
  const { f, v: layered } = withBodiesOn(2, others, { see: true });
  const v = open(layered);
  const verifyOf = (block: string) => {
    const lines = block.split('\n');
    return lines.filter((_, i) => i > lines.indexOf('Verify'));
  };

  it('shows “See it” above “Exact check” in each body’s block, from that body', () => {
    expect(v.packet.bodies.map((b) => b.key)).toEqual(['nextjs', ...others]);
    for (const body of v.packet.bodies) {
      const see = seeFor(body.key);
      const own = packetBodies(f.packet!).find((b) => b.framework === body.key)!;
      const head = [
        '  See it',
        `    ${see.command}`,
        `    Today: ${see.today}`,
        `    After the fix: ${see.after}`,
        '  Exact check',
        `    ${own.verify.command}`,
        `    → expect ${own.verify.expect}`,
      ];
      const verify = verifyOf(body.block);
      expect(
        verify.filter((_, i) => i < head.length),
        body.key,
      ).toEqual(head);
      expect(verify.at(-1), body.key).toBe(
        '  We run the exact check on all 158 pages when you mark the fix done.',
      );
      // No other body's readable command is in this one's block or prompt.
      for (const other of ['nextjs', ...others].filter((k) => k !== body.key)) {
        const theirs = seeFor(other as PacketFramework);
        for (const s of [theirs.command, theirs.today, theirs.after]) {
          expect(body.block, `${body.key} block`).not.toContain(s);
          expect(body.prompt, `${body.key} prompt`).not.toContain(s);
        }
      }
    }
  });

  it('says which line of the block is the strict command, for the page to show on one line', () => {
    for (const body of v.packet.bodies) {
      const own = packetBodies(f.packet!).find((b) => b.framework === body.key)!;
      expect(body.exactLine, body.key).not.toBeNull();
      expect(body.block.split('\n')[body.exactLine!], body.key).toBe(`    ${own.verify.command}`);
    }
  });

  it('keeps the crawler lines under the exact check, for a command that requests as a crawler', () => {
    // Fix 2's own body requests as OAI-SearchBot (the fixture's `verify.ua`).
    expect(verifyOf(v.own.block).filter((_, i) => i >= 7)).toEqual([
      '  # we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string',
      '  Requests as OAI-SearchBot, which gets 200 today.',
      '  We run the exact check on all 158 pages when you mark the fix done.',
    ]);
  });

  it('carries both commands in the prompt, labelled, and says the exact check decides', () => {
    const body = v.packet.bodies[1]!;
    const lines = body.prompt.split('\n');
    expect(lines.filter((_, i) => i >= lines.indexOf('Keep:') + 3)).toEqual([
      'Verify (we run the exact check after you mark done):',
      'See it (a short command that prints the evidence; it decides nothing):',
      `  ${seeFor('wordpress').command}`,
      `  Today: ${seeFor('wordpress').today}`,
      `  After the fix: ${seeFor('wordpress').after}`,
      'Exact check (this command decides whether the fix has landed):',
      `  ${bodyFor('wordpress').verify.command}`,
      `  → expect ${bodyFor('wordpress').verify.expect}`,
    ]);
  });

  it('a body without a readable command is shown as before: one command, no layer named', () => {
    const plain = open(view(2));
    expect(plain.own.exactLine).toBeNull();
    const p = fixOf(2).packet!;
    expect(p.verify.see).toBeNull();
    // Written out by hand: the verify section of the bad site's fix 2, as the locked screen has it.
    expect(verifyOf(plain.own.block)).toEqual([
      `  ${p.verify.command}`,
      `    → expect ${p.verify.expect}`,
      '  # we run the same request with a tagged user agent; your result and ours can differ only if a rule matches the exact string',
      '  Requests as OAI-SearchBot, which gets 200 today.',
      '  We run this on all 158 pages when you mark the fix done.',
    ]);
    for (const text of [plain.own.block, plain.own.prompt]) {
      expect(text).not.toMatch(/See it|Exact check|exact check|After the fix:/);
    }
    expect(plain.own.prompt.split('\n').filter((l) => l.startsWith('Verify'))).toEqual([
      'Verify (we run this after you mark done):',
    ]);
  });

  it('one body with a readable command beside one without: each is shown in its own way', () => {
    const { d } = edited('bad-site');
    const p = fix2(d).packet!;
    p.packets = [
      { ...bodyFor('webflow'), verify: { ...bodyFor('webflow').verify, see: seeFor('webflow') } },
    ];
    const w = open(fixView(d, BAD, fixOf(2).id, { asFirstSeen: true }));
    expect(w.packet.bodies.map((b) => b.exactLine === null)).toEqual([true, false]);
    expect(w.packet.bodies[0]!.block).not.toContain('See it');
    expect(w.packet.bodies[1]!.block).toContain(`    ${seeFor('webflow').command}`);
  });
});

describe('fixView: where the fix stands', () => {
  it('gives the fix’s place in the order beside its number when the two differ', () => {
    expect(view(5).frame.position).toBe('Fix 5 · 4 of 13');
    expect(view(3).frame.position).toBe('Fix 3 of 13');
  });
});

describe('fixView: other fixtures and states', () => {
  it('shows the challenged site’s one body with no switch, and the crawler its check requests as', () => {
    const d = fixture('challenged-site');
    const check = findCheck(d, FIRST_AUDIT['challenged-site']);
    const [first] = fixesAsOf(d, check);
    const v = open(fixView(d, check.id, first!.id));
    expect(v.packet.bodies).toHaveLength(1);
    expect(v.switcher).toBeNull();
    expect(v.beforeAfter).toBeNull();
    // The fixture's `verify.ua` names the crawler; the block reads that field, not the command.
    const crawler = check.crawlers.find((c) => c.ua === first!.packet!.verify.ua)!;
    expect(v.own.block).toContain(`Requests as ${crawler.ua}, which gets ${crawler.status} today.`);
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
    if (v.kind !== 'open') return;
    expect(v.packet).toBeNull();
    expect(v.switcher).toBeNull();
    expect(v.notWritten).toBe(noPacketLine(noPacketReason(f.type)));
  });

  it('says why a fix has no packet exactly when it has none', () => {
    for (const name of ['bad-site', 'challenged-site', 'built-site'] as const) {
      const d = fixture(name);
      for (const check of d.checks.filter((c) => c.finished_at !== null)) {
        for (const f of fixesAsOf(d, check)) {
          const v = fixView(d, check.id, f.id, { plan: 'pro' });
          if (v.kind !== 'open') throw new Error(v.kind);
          expect(v.notWritten === null, `${name} fix ${f.number}`).toBe(f.packet !== null);
          expect(v.packet === null, `${name} fix ${f.number}`).toBe(f.packet === null);
        }
      }
    }
  });

  it('refuses a fix of another site, and one the check has not seen yet', () => {
    const d = fixture('bad-site');
    const other = d.fixes.find((x) => x.status === 'verified_resolved')!;
    expect(() => fixView(d, BAD, other.id)).toThrow(/another site/);
    expect(() => fixView(d, BAD, fixOf(0).id)).toThrow(/not seen/);
  });
});
