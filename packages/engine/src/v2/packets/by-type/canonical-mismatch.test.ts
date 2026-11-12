import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { site, type PageSpec } from '../../../../fixtures/v2/detectors/builders.js';
import { detectCanonicalMismatch } from '../../detectors/canonical-mismatch.js';
import type { Condition, DetectorInput } from '../../detectors/types.js';
import { NO_STACK, factsFor } from '../test-support/facts.js';
import {
  anchors,
  detected,
  expectDeterministic,
  expectHostileSafe,
  hostile,
  hostileUrl,
  NOT_A_URL,
  packetOf,
  pageAsRead,
  pageAt,
  HOME_AT_EN,
  seen,
  SERVED,
  servedSite,
  SPELLINGS,
} from '../test-support/structure.js';
import { inBothStates, twoStateSite, type TwoStateSite } from '../test-support/verify.js';
import { canonicalMismatch } from './canonical-mismatch.js';
import type { PacketFacts } from '../types.js';

let served: TwoStateSite | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

type Shape =
  | 'cross_host'
  | 'redirects'
  | 'redirects_to_unread'
  | 'gone'
  | 'not_canonical'
  | 'disallowed'
  | 'linked'
  | 'redirects_and_linked'
  | 'gone_and_linked';

/** /p declares a canonical that is broken in the way `shape` names; the home page links to /p when it says so. */
function canonicalSite(base: string, shape: Shape): DetectorInput {
  const u = (path: string) => `${base}${path}`;
  const sound = { canonical: { href: null } };
  const linked = shape === 'linked' || shape.endsWith('_and_linked');
  const home: PageSpec = {
    path: base,
    links: linked ? [u('/p'), u('/t2')] : [u('/t2')],
    facts: sound,
  };
  const p = (href: string): PageSpec => ({
    path: u('/p'),
    links: [base],
    facts: { canonical: { href } },
  });
  const t2: PageSpec = { path: u('/t2'), links: [base], facts: { canonical: { href: u('/t2') } } };
  switch (shape) {
    case 'cross_host':
      return site([home, p('https://other.test/p'), t2], { homepage: base });
    case 'redirects':
    case 'redirects_and_linked':
      return site(
        [
          home,
          p(u('/t')),
          t2,
          { path: u('/t'), facts: { final_url: u('/t2/'), canonical: { href: u('/t2') } } },
        ],
        { homepage: base },
      );
    case 'redirects_to_unread':
      return site([home, p(u('/t')), t2, { path: u('/t'), facts: { final_url: u('/t3') } }], {
        homepage: base,
      });
    case 'gone':
    case 'gone_and_linked':
      return site([home, p(u('/t')), t2, { path: u('/t'), status: 404 }], { homepage: base });
    case 'not_canonical':
      return site(
        [
          home,
          p(u('/t')),
          t2,
          { path: u('/t'), links: [base], facts: { canonical: { href: u('/t2') } } },
        ],
        { homepage: base },
      );
    case 'disallowed':
      return site([home, p(u('/t')), t2], { homepage: base, disallowed: [{ path: u('/t') }] });
    case 'linked':
      return site([home, p(u('/t2')), t2], { homepage: base });
  }
}

const packetFor = (input: DetectorInput, base: string, stack = NO_STACK) =>
  packetOf(
    'canonical_mismatch',
    detected(detectCanonicalMismatch(input), `${base}/p`),
    factsFor(input, SERVED, stack),
  );

const base = 'https://a.test';
const GOOGLE =
  'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls';

describe('the canonical_mismatch packet', () => {
  it.each<[Shape, Condition[], string]>([
    [
      'cross_host',
      ['canonical_cross_host'],
      '`https://other.test/p` is on another host than the page: the canonical asks search engines to index that URL in place of this one.',
    ],
    [
      'redirects',
      ['canonical_target_redirects'],
      '`https://a.test/t` redirects to `https://a.test/t2/`.',
    ],
    [
      'gone',
      ['canonical_target_gone'],
      '`https://a.test/t` answers 404: the page the canonical names is gone.',
    ],
    [
      'not_canonical',
      ['canonical_target_not_canonical'],
      '`https://a.test/t` itself declares another canonical, `https://a.test/t2`.',
    ],
    [
      'disallowed',
      ['canonical_target_disallowed'],
      'robots.txt disallows `https://a.test/t` for Googlebot, Bingbot, so a search engine cannot read the page the canonical names.',
    ],
  ])('says what is wrong with the canonical when it %s', (shape, conditions, sentence) => {
    const input = canonicalSite(base, shape);
    expect(detected(detectCanonicalMismatch(input), `${base}/p`).conditions).toEqual(conditions);
    const declared = shape === 'cross_host' ? 'https://other.test/p' : 'https://a.test/t';
    expect(packetFor(input, base).context).toEqual([
      `\`https://a.test/p\` declares \`${declared}\` as its canonical.`,
      sentence,
    ]);
  });

  it('names the pages that link to the non-canonical URL, and no fault of the canonical it did not prove', () => {
    const p = packetFor(canonicalSite(base, 'linked'), base);
    expect(p.context).toEqual([
      '`https://a.test/p` declares `https://a.test/t2` as its canonical.',
      '1 page links to `https://a.test/p`, a URL that names another as its canonical: `https://a.test`.',
    ]);
    expect(p.change).toEqual([
      `Change the links to \`https://a.test/p\` on \`https://a.test\` so that they point at \`https://a.test/t2\`. Google: "When linking within your site, link to the canonical URL rather than a duplicate URL" (${GOOGLE}).`,
      'Where a link is meant to open this URL as a variant (a filter, a sort order, a tracked link), leaving it is a choice the canonical already covers; the command below stays non-zero while such a link is on the page it reads.',
      'If `https://a.test/p` is meant to be indexed in its own right, make its canonical its own URL instead; the command below checks the links.',
    ]);
    expect(p.frameworks).toEqual(['generic']);
  });

  it.each<[Shape, string]>([
    ['cross_host', 'https://a.test/p'],
    ['gone', 'https://a.test/p'],
    ['disallowed', 'https://a.test/p'],
    ['redirects_to_unread', 'https://a.test/p'],
    ['redirects', 'https://a.test/t2'],
    ['not_canonical', 'https://a.test/t2'],
  ])('when the canonical %s, expects %s', (shape, expected) => {
    const p = packetFor(canonicalSite(base, shape), base);
    expect(p.verify.command).toMatch(
      /^curl -sS -f --compressed --max-time 20 -A '[^']*' -w '[^']*' 'https:\/\/a\.test\/p' \| tr '[^']*' '[^']*' \| LC_ALL=C awk '/,
    );
    expect(p.verify.command.endsWith(`}' '1' '${expected}' '0'`)).toBe(true);
    expect(p.change.join(' ')).toContain(
      expected === 'https://a.test/p'
        ? 'et the rel="canonical" of `https://a.test/p` to its own URL.'
        : `Set the rel="canonical" of \`https://a.test/p\` to \`${expected}\``,
    );
    expect(p.context.join(' ')).not.toContain('developers.google.com');
  });

  it('sends the links to the new canonical too when it is another URL, and leaves them when it is the page', () => {
    const moved = packetFor(canonicalSite(base, 'redirects_and_linked'), base);
    expect(moved.change.join(' ')).toContain('so that they point at `https://a.test/t2`');
    // one request for the page and the page that links to it, read by one program
    expect(moved.verify.command).toContain(" 'https://a.test/p' 'https://a.test/' | ");
    expect(moved.verify.command.match(/curl|awk/g)).toEqual(['curl', 'awk']);
    expect(
      moved.verify.command.endsWith(
        "}' '2' 'https://a.test/t2' '0' '1' 'https://a.test/p' '1' 'https://a.test/t2'",
      ),
    ).toBe(true);
    const kept = packetFor(canonicalSite(base, 'gone_and_linked'), base);
    expect(kept.change.join(' ')).not.toContain('Change the links');
    expect(kept.keep.at(-1)).toBe(
      'Keep the links to `https://a.test/p`: once it is its own canonical they point at the canonical URL.',
    );
    expect(kept.verify.command).toContain(" 'https://a.test/p' | ");
  });

  it('writes a Next.js body when the canonical itself changes, citing the page it rests on', () => {
    const p = packetFor(canonicalSite(base, 'gone'), base);
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
    const next = p.packets[0]!;
    expect(next.change.slice(0, 3)).toEqual([
      'These steps are for the App Router (the app directory). There the tag comes from alternates.canonical in the metadata export, or in generateMetadata, of the page.js of the route or of a layout.js above it.',
      'Set the rel="canonical" of `https://a.test/p` to its own URL.',
      "If another live URL of this site is the one meant to be indexed for this content, name that one instead; the command below checks for the page's own URL.",
    ]);
    // setting alternates.canonical in a page drops a layout's alternates.languages: the body says so
    expect(next.change[3]).toContain(
      'a segment that sets alternates replaces the whole alternates object of the layouts above it',
    );
    expect(next.keep.at(-1)).toBe(
      'Keep the other fields of alternates the page has today (languages, media, types).',
    );
    expect(packetFor(canonicalSite(base, 'linked'), base).frameworks).toEqual(['generic']);
  });

  // round 2, SEO finding 3: what the two Next.js pages say, and no more
  it('says when Next.js sends metadata after the first HTML, and that a value replaces the default list', () => {
    const next = packetFor(canonicalSite(base, 'gone'), base).packets[0]!;
    expect(next.framework).toBe('nextjs');
    const step = next.change.find((line) => line.includes('htmlLimitedBots'))!;
    expect(step).toBe(
      'When a page cannot be prerendered, or its generateMetadata introduces dynamic behavior, Next.js can send the metadata tags after the first HTML, appended to the <body>; user agents on its list of HTML-limited bots get them in the <head>. The command below reads the <head>. Either make the page one that can be prerendered, with a generateMetadata that introduces no dynamic behavior, or extend the default list: a value for htmlLimitedBots in the Next.js config overrides the default list, so repeat the default bots in it and add the crawler the command requests as.',
    );
    expect(step).not.toMatch(/waits on data|add the crawler to htmlLimitedBots/);
    const sources =
      canonicalMismatch.kind === 'builder' ? canonicalMismatch.stacks.nextjs!.sources : [];
    expect(sources.map((s) => s.url)).toEqual([
      'https://nextjs.org/docs/app/api-reference/functions/generate-metadata',
      'https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots',
    ]);
    expect(sources[1]!.supports).toContain("will override the Next.js' default list");
  });

  it('says a canonical that is not a web address is that, not that it is on another host', () => {
    const u = (path: string) => `${base}${path}`;
    const input = site(
      [
        { path: base, links: [u('/p')], facts: { canonical: { href: null } } },
        { path: u('/p'), links: [base], facts: { canonical: { href: 'mailto:shop@other.test' } } },
      ],
      { homepage: base },
    );
    const record = detected(detectCanonicalMismatch(input), u('/p'));
    expect(record.conditions).toContain('canonical_cross_host');
    const p = packetOf('canonical_mismatch', record, factsFor(input, SERVED));
    expect(p.context[1]).toBe(
      '`mailto:shop@other.test` is not a web address (http or https), so it names no page a search engine can index in place of this one.',
    );
    expect(p.context.join(' ')).not.toContain('another host');
    expect(p.change[0]).toBe('Set the rel="canonical" of `https://a.test/p` to its own URL.');
  });

  const page = (canonical: string) =>
    `<html><head><link rel="canonical" href="${canonical}"></head><body><a href="/">home</a></body></html>`;

  describe.each<[Shape, string]>([
    ['cross_host', '/p'],
    ['gone', '/p'],
    ['disallowed', '/p'],
    ['redirects', '/t2'],
    ['not_canonical', '/t2'],
  ])('verify, when the canonical %s', (shape, fixedCanonical) => {
    it('fails on the declared canonical and passes on the expected one', async () => {
      const bad = shape === 'cross_host' ? 'https://other.test/p' : '/t';
      served = await servedSite({
        broken: { '/p': page(bad) },
        fixed: { '/p': page(fixedCanonical) },
      });
      const p = packetFor(canonicalSite(served.base, shape), served.base);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  // round 2, SEO finding 6: a correct canonical, written as a page can write it
  it.each<[string, (b: string) => string]>([
    ['the path from the root', () => '/p'],
    ['the path alone, from a page in the same directory', () => 'p'],
    ['a protocol-relative URL', (b) => `//${new URL(b).host}/p`],
    ['the scheme and host in upper case', (b) => `HTTP://${new URL(b).host.toUpperCase()}/p`],
    ['a slash at its end', (b) => `${b}/p/`],
    ['an empty query', (b) => `${b}/p?`],
  ])('verify passes on the expected canonical written as %s', async (_name, written) => {
    let origin = '';
    served = await servedSite({
      broken: { '/p': page('/t') },
      fixed: {
        get '/p'() {
          return page(written(origin));
        },
      },
    });
    origin = served.base;
    const p = packetFor(canonicalSite(origin, 'gone'), origin);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('verify passes on a self-canonical whose query writes its parameters in another order', async () => {
    const path = '/list?page=2&sort=price';
    served = await servedSite({
      broken: { [path]: page('/gone') },
      fixed: { [path]: page('/list?sort=price&page=2') },
    });
    const b = served.base;
    const input = site(
      [
        { path: b, links: [`${b}${path}`], facts: { canonical: { href: null } } },
        { path: `${b}${path}`, links: [b], facts: { canonical: { href: `${b}/gone` } } },
        { path: `${b}/gone`, status: 404 },
      ],
      { homepage: b },
    );
    const p = packetOf(
      'canonical_mismatch',
      detected(detectCanonicalMismatch(input), `${b}${path}`),
      factsFor(input, SERVED),
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('shows the canonical with a command to read, and what it prints today and after', async () => {
    served = await servedSite({ broken: { '/p': page('/t') }, fixed: { '/p': page('/p') } });
    const b = served.base;
    const p = packetFor(canonicalSite(b, 'gone'), b);
    expect(p.verify.see).toEqual({
      command: expect.stringMatching(
        /^curl -sS --compressed --max-time 20 -A '[^']*' '[^']*\/p' \| tr '[^']*' ' {3}' \| grep -aioE '<link \[\^>\]\*rel=\.\?canonical\[\^>\]\*>'$/,
      ),
      today: `The page's canonical tag, which names \`${b}/t\`.`,
      after: `The page's canonical tag, naming \`${b}/p\`.`,
    });
    const printed = await seen(served, p);
    expect(printed.broken).toBe('<link rel="canonical" href="/t">\n');
    expect(printed.fixed).toBe('<link rel="canonical" href="/p">\n');
  });

  // round 2, SEO finding 1: the linking page answers at another address than the one the crawl names it by
  it('when the linking page is a homepage that answers at /en/, verify requests /en/ in both states', async () => {
    served = await servedSite({
      broken: { ...HOME_AT_EN, '/en/': anchors(['/p', '/t2']), '/p': page('/t2') },
      fixed: { ...HOME_AT_EN, '/en/': anchors(['/t2']), '/p': page('/t2') },
    });
    const b = served.base;
    const input = canonicalSite(b, 'linked');
    const facts = factsFor(input, SERVED);
    const pages = new Map(facts.pages);
    pages.set(b, { ...pages.get(b)!, final_url: `${b}/en/` });
    const live = { ...input, pages: [...pages.values()] };
    const p = packetOf('canonical_mismatch', detected(detectCanonicalMismatch(live), `${b}/p`), {
      ...facts,
      pages,
    });
    expect(p.verify.command).toContain(` '${b}/en/' | `);
    expect(p.verify.expect).toContain(
      `Exit status 0 once \`${b}/en/\` (where \`${b}\` answers) links to \`${b}/t2\``,
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    const printed = await seen(served, p);
    expect(printed.broken).toContain('<a href="/p">');
    expect(printed.fixed).toBe('<a href="/t2">\n');
  });

  it('judges the canonical of no page whose request ended at another address, so the page read answers where it is named', () => {
    const u = (path: string) => `${base}${path}`;
    const input = site(
      [
        { path: base, links: [u('/p')], facts: { canonical: { href: null } } },
        {
          path: u('/p'),
          links: [base],
          facts: { final_url: u('/en/p'), canonical: { href: u('/t') } },
        },
        { path: u('/t'), status: 404 },
      ],
      { homepage: base },
    );
    expect(
      detectCanonicalMismatch(input).filter((r) => r.state === 'detected' && r.key.endsWith('/p')),
    ).toEqual([]);
  });

  it('verify, for links under a non-canonical URL, fails until the linking page links to the canonical', async () => {
    served = await servedSite({
      broken: { '/': anchors(['/p', '/t2']), '/p': page('/t2') },
      fixed: { '/': anchors(['/t2']), '/p': page('/t2') },
    });
    const p = packetFor(canonicalSite(served.base, 'linked'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it.each([
    ['only the canonical mended', { '/': anchors(['/p']), '/p': page('/t2') }],
    ['only the links mended', { '/': anchors(['/t2']), '/p': page('/t') }],
  ])(
    'verify, when the canonical and the links both change, is not passed by %s',
    async (_n, half) => {
      served = await servedSite({ broken: half, fixed: half });
      const p = packetFor(canonicalSite(served.base, 'redirects_and_linked'), served.base);
      expect((await inBothStates(served, p.verify.command)).fixed.status).not.toBe(0);
    },
  );

  it('verify, when the canonical and the links both change, passes once both are mended', async () => {
    served = await servedSite({
      broken: { '/': anchors(['/p', '/t2']), '/p': page('/t') },
      fixed: { '/': anchors(['/t2']), '/p': page('/t2') },
    });
    const p = packetFor(canonicalSite(served.base, 'redirects_and_linked'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });
});

/** The home page links to `path`, which declares `href` as its canonical; `others` are further pages. */
function linkedSite(base: string, href: string, others: PageSpec[] = [], path = '/p') {
  const u = (at: string) => `${base}${at}`;
  return site(
    [
      { path: base, links: [u(path), u('/t2')], facts: { canonical: { href: null } } },
      { path: u(path), links: [base], facts: { canonical: { href } } },
      { path: u('/t2'), links: [base], facts: { canonical: { href: u('/t2') } } },
      ...others,
    ],
    { homepage: base },
  );
}

describe('a canonical no fault is proven of, on a page the site links to', () => {
  const head = (canonical: string) =>
    `<html><head><link rel="canonical" href="${canonical}"></head><body></body></html>`;

  // the round 1 security review's inputs: the worker stores each as { href, url: null }
  describe.each(NOT_A_URL)('declared as %s, which is no URL', (href) => {
    const input = linkedSite(base, href);
    const record = detected(detectCanonicalMismatch(input), `${base}/p`);

    it('is written a packet that asks for the page’s own URL and moves no link', () => {
      expect(record.conditions).toEqual(['linked_under_non_canonical']);
      expect(input.pages.find((p) => p.url === `${base}/p`)!.canonical_declared).toEqual({
        href,
        url: null,
      });
      const p = packetOf('canonical_mismatch', record, factsFor(input, SERVED));
      expect(p.context.at(-1)).toBe(
        `\`${href}\` is not an http or https URL, so it names no page.`,
      );
      expect(p.change[0]).toMatch(
        /^Set the rel="canonical" of `https:\/\/a\.test\/p` to its own URL, or check /,
      );
      expect(p.change.join(' ')).not.toContain('Change the links');
      expect(p.verify.command.endsWith(`}' '1' 'https://a.test/p' '0'`)).toBe(true);
    });

    it('verify fails on the declared canonical and passes on the page’s own', async () => {
      served = await servedSite({
        broken: { '/p': head(href) },
        fixed: { '/p': head('/p') },
      });
      const p = packetFor(linkedSite(served.base, href), served.base);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });

  it.each<[string, PageSpec[], string]>([
    [
      'the crawl never requested',
      [],
      'The crawl holds no page that answered at `https://a.test/t`, so the audit cannot say the canonical names a live page.',
    ],
    [
      'answered 503',
      [{ path: `${base}/t`, status: 503 }],
      "The crawl's request for `https://a.test/t` ended with status 503, so the audit cannot say the canonical names a live page.",
    ],
  ])('does not send the links to a canonical that %s', (_name, others, why) => {
    const input = linkedSite(base, `${base}/t`, others);
    const record = detected(detectCanonicalMismatch(input), `${base}/p`);
    expect(record.conditions).toEqual(['linked_under_non_canonical']);
    const p = packetOf('canonical_mismatch', record, factsFor(input, SERVED));
    expect(p.context.at(-1)).toBe(why);
    expect(p.change.join(' ')).not.toContain('Change the links');
    expect(p.change[0]).toContain('to its own URL, or check `https://a.test/t` by hand');
    expect(p.keep.at(-1)).toContain('Keep the links to `https://a.test/p`');
    expect(p.frameworks).toEqual(['generic', 'nextjs']);
  });

  it('sends the links to a canonical the check holds answering 200 at itself', () => {
    const p = packetFor(linkedSite(base, `${base}/t2`), base);
    expect(p.change[0]).toContain('Change the links to `https://a.test/p`');
    expect(p.verify.command).not.toContain('canonical');
  });

  describe.each(SPELLINGS)('whose URL holds %s', (_name, recorded, written) => {
    it.each(written)('verify finds the stale link written as %s', async (anchor) => {
      const kept = '<a href="/t2">y</a>';
      served = await servedSite({ broken: { '/': `${anchor}${kept}` }, fixed: { '/': kept } });
      const input = linkedSite(served.base, `${served.base}/t2`, [], recorded);
      const p = packetOf(
        'canonical_mismatch',
        detected(detectCanonicalMismatch(input), `${served.base}${recorded}`),
        factsFor(input, SERVED),
      );
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
    });
  });
});

describe('the canonical_mismatch packet, on what a search engine reads', () => {
  const tag = (href: string) => `<link rel="canonical" href="${href}">`;
  const html = (head: string, body = '') =>
    `<html><head><title>p</title>${head}</head><body>${body}<a href="/">home</a></body></html>`;

  it('asks first whether a canonical on another host is deliberate', () => {
    const p = packetFor(canonicalSite(base, 'cross_host'), base);
    expect(p.change.slice(0, 2)).toEqual([
      'Decide first whether `https://other.test/p` is deliberate: a page republished from another site can name the original as its canonical on purpose. If it is, leave it; this fix does not apply.',
      'Otherwise set the rel="canonical" of `https://a.test/p` to its own URL.',
    ]);
  });

  it('cites Google beside the sentences its page states, and nowhere else', () => {
    const p = packetFor(canonicalSite(base, 'gone_and_linked'), base);
    const cited = [...p.context, ...p.change, ...p.keep].filter((l) => l.includes(GOOGLE));
    expect(cited).toEqual([
      `Write it as one <link rel="canonical"> in the <head>, with an absolute URL. Google accepts the element only in the <head>, and asks for absolute paths (${GOOGLE}).`,
    ]);
  });

  // the round 1 SEO review's inputs
  it.each<[string, string, boolean]>([
    [
      'the old tag commented out above the correct one',
      html(`<!-- ${tag('/t')} -->${tag('/p')}`),
      true,
    ],
    [
      'the page’s head left unclosed',
      `<html><head><title>p</title>${tag('/p')}<body><p>x</p>`,
      true,
    ],
    ['two conflicting canonicals', html(`${tag('/p')}${tag('/t')}`), false],
    ['the tag only in the <body>', html('', tag('/p')), false],
    ['only a commented-out tag', html(`<!-- ${tag('/p')} -->`), false],
  ])('verify, with %s, passes: %s', async (_name, fixedHtml, passes) => {
    served = await servedSite({ broken: { '/p': html(tag('/t')) }, fixed: { '/p': fixedHtml } });
    const p = packetFor(canonicalSite(served.base, 'gone'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status === 0).toBe(passes);
    expect(p.verify.expect).toContain('A canonical sent in an HTTP Link header is not read.');
  });

  it('on a site that serves its pages with a trailing slash, requests and names the served address', async () => {
    served = await servedSite({
      broken: { '/p/': html(tag('/t/')) },
      fixed: { '/p/': html(tag('/p/')) },
    });
    const u = (path: string) => `${served!.base}${path}`;
    const input = site(
      [
        { path: served.base, links: [u('/t2')], facts: { canonical: { href: null } } },
        { path: u('/p'), facts: { final_url: u('/p/'), canonical: { href: u('/t') } } },
        { path: u('/t2'), facts: { final_url: u('/t2/'), canonical: { href: u('/t2') } } },
        { path: u('/t'), status: 404 },
      ],
      { homepage: served.base },
    );
    const p = packetFor(input, served.base);
    expect(p.change[0]).toBe(`Set the rel="canonical" of \`${u('/p/')}\` to its own URL.`);
    expect(p.verify.command).toContain(` '${u('/p/')}' | `);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  it('agrees with the engine’s own reading of the pages served', async () => {
    const pages = (canonical: string, links: string[]) => ({
      '/': anchors(links),
      '/p': html(tag(canonical)),
      '/t2': html(tag('/t2')),
    });
    const states = { broken: pages('/t2', ['/p', '/t2']), fixed: pages('/t2', ['/t2']) };
    served = await servedSite(states);
    const read = (state: 'broken' | 'fixed') =>
      site(
        Object.entries(states[state]).map(([path, body]) =>
          pageAsRead(path === '/' ? served!.base : `${served!.base}${path}`, body),
        ),
        { homepage: served!.base },
      );
    const p = packetFor(read('broken'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectCanonicalMismatch(read('fixed')).filter((r) => r.state === 'detected')).toEqual(
      [],
    );
  });
});

describe('the canonical_mismatch packet over hostile records (properties)', () => {
  const TARGET: Condition[] = [
    'canonical_cross_host',
    'canonical_target_redirects',
    'canonical_target_gone',
    'canonical_target_not_canonical',
    'canonical_target_disallowed',
  ];
  const arb = fc.record({
    page: hostileUrl(),
    // a URL, an href the worker stores unresolved, or any text at all
    declared: fc.oneof(hostileUrl('https://b.test'), fc.constantFrom(...NOT_A_URL), hostile()),
    onward: hostileUrl(),
    target: fc.option(fc.constantFrom(...TARGET), { nil: null }),
    linking: fc.uniqueArray(hostileUrl(), { maxLength: 10 }),
    framework: fc.constantFrom(null, 'nextjs' as const),
  });
  type Rec = typeof arb extends fc.Arbitrary<infer T> ? T : never;
  const isUrl = (text: string) => URL.canParse(text) && /^https?:/.test(text);
  const build = ({ page, declared, onward, target, linking, framework }: Rec) => {
    const input = canonicalSite('https://a.test', 'linked');
    const record = { ...detected(detectCanonicalMismatch(input), 'https://a.test/p') };
    const from = linking.filter((l) => l !== page).sort();
    const conditions: Condition[] = [
      ...(target === null ? [] : [target]),
      ...(from.length > 0 ? (['linked_under_non_canonical'] as const) : []),
    ];
    record.key = `canonical:${page}`;
    record.conditions = conditions.sort();
    record.measured = from.length;
    record.affected_urls = [page];
    record.evidence = {
      pages: [page, declared].sort(),
      edges: from.map((from_url) => ({ from_url, to_url: page })),
    };
    const facts: PacketFacts = {
      ...factsFor(
        input,
        SERVED,
        framework === null
          ? NO_STACK
          : {
              ...NO_STACK,
              frontend: {
                name: 'x',
                framework,
                version: null,
                router: null,
                detected_from: 'a test',
              },
            },
      ),
      pages: new Map([
        [
          page,
          pageAt(page, {
            canonical_declared: { href: declared, url: isUrl(declared) ? declared : null },
          }),
        ],
        ...(isUrl(declared)
          ? ([
              [
                declared,
                pageAt(declared, {
                  status_code: target === 'canonical_target_gone' ? 404 : 200,
                  final_url: onward,
                  canonical_declared: { href: onward, url: onward },
                }),
              ],
            ] as const)
          : []),
        [onward, pageAt(onward, { canonical_declared: { href: null, url: null } })],
      ]),
    };
    return { record, facts };
  };

  it('lets nothing crawled out of a code span or a quoted word, and adds no line', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        fc.pre(record.conditions.length > 0 && r.page !== r.declared && r.page !== r.onward);
        expectHostileSafe(packetOf('canonical_mismatch', record, facts));
      }),
    );
  });

  it('gives the same packet for the same record and facts', () => {
    fc.assert(
      fc.property(arb, (r) => {
        const { record, facts } = build(r);
        fc.pre(record.conditions.length > 0 && r.page !== r.declared && r.page !== r.onward);
        expectDeterministic('canonical_mismatch', record, facts);
      }),
    );
  });
});

// Round 3. Each input is a reviewer's, and each test was red before the change it names.
describe('the canonical_mismatch packet, round 3', () => {
  const tag = (href: string) => `<link rel="canonical" href="${href}">`;
  const html = (head: string, body = '') =>
    `<html><head><title>p</title>${head}</head><body>${body}<a href="/">home</a></body></html>`;
  // the Meta Pixel snippet, as its vendor has it pasted into the head
  const PIXEL =
    '<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1"/></noscript>';

  // SEO finding 4: the reader ended the head at the <img>, so the command never exited 0
  it('verify reads a canonical after the Meta Pixel’s <noscript><img> in the head, as the engine’s reader does', async () => {
    const states = {
      broken: {
        '/': anchors(['/t2']),
        '/p': html(`${PIXEL}${tag('/t')}`),
        '/t2': html(tag('/t2')),
      },
      fixed: { '/': anchors(['/t2']), '/p': html(`${PIXEL}${tag('/p')}`), '/t2': html(tag('/t2')) },
    };
    served = await servedSite(states);
    const b = served.base;
    const read = (state: 'broken' | 'fixed') =>
      site(
        [
          ...Object.entries(states[state]).map(([path, body]) =>
            pageAsRead(path === '/' ? b : `${b}${path}`, body),
          ),
          { path: `${b}/t`, status: 404 },
        ],
        { homepage: b },
      );
    // the engine's reader reads the canonical after the snippet: the record is made from its reading
    const p = packetFor(read('broken'), b);
    expect(p.context[0]).toBe(`\`${b}/p\` declares \`${b}/t\` as its canonical.`);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
    expect(detectCanonicalMismatch(read('fixed')).filter((r) => r.state === 'detected')).toEqual(
      [],
    );
  });

  // SEO finding 6 (D3): the stale URL and the kept one are one URL to the programs, and the command
  // checked the canonical, which stands, so it passed before the fix and said so
  describe('links to a URL the programs read as one with the canonical (/x%7Ey and /x~y)', () => {
    const input = (b: string) =>
      linkedSite(
        b,
        `${b}/x~y`,
        [{ path: `${b}/x~y`, links: [b], facts: { canonical: { href: `${b}/x~y` } } }],
        '/x%7Ey',
      );
    const packet = (b: string) =>
      packetOf(
        'canonical_mismatch',
        detected(detectCanonicalMismatch(input(b)), `${b}/x%7Ey`),
        factsFor(input(b), SERVED),
      );

    it('compares the links’ hrefs as they are spelled, and says so; today differs from after', () => {
      const p = packet(base);
      expect(p.verify.expect).toBe(
        'Exit status 0 once `https://a.test` links to `https://a.test/x~y` spelled so, character for character once the href is resolved, and to no other spelling of that URL. Today it links to `https://a.test/x%7Ey`, which most readers take for the same URL. An href the command cannot read counts as another spelling. A page that itself prints "crawlmouse:end" does not pass.',
      );
      expect(p.verify.command).toContain('function spelled(');
      expect(p.verify.see?.today).toBe(
        'The <a> tags that link to `https://a.test/x%7Ey`: lines that hold `/x%7Ey`.',
      );
      expect(p.verify.see?.after).toBe(
        'The <a> tags that link to `https://a.test/x~y`, lines that hold `/x~y`, and none that links to `https://a.test/x%7Ey`.',
      );
      expect(p.verify.see?.today).not.toBe(p.verify.see?.after);
    });

    it('verify fails before the fix and passes after it', async () => {
      const page = html(tag('/x~y'));
      served = await servedSite({
        broken: { '/': anchors(['/x%7Ey', '/t2']), '/x%7Ey': page, '/x~y': page },
        fixed: { '/': anchors(['/x~y', '/t2']), '/x%7Ey': page, '/x~y': page },
      });
      const p = packet(served.base);
      const { broken, fixed } = await inBothStates(served, p.verify.command);
      expect(broken.status).not.toBe(0);
      expect(fixed.status).toBe(0);
      const printed = await seen(served, p);
      expect(printed.broken).toBe('<a href="/x%7Ey">\n');
      expect(printed.fixed).toBe('<a href="/x~y">\n');
    });
  });

  it('compares the canonical’s href as it is spelled when the one declared and the one expected are one URL to the programs', async () => {
    // /p declares /t%7E, which redirects to /t~: the expected canonical is /t~, and a command that
    // compared the two as the programs do would pass on the canonical the page has today
    const page = (href: string) => html(tag(href));
    served = await servedSite({
      broken: { '/p': page('/t%7E') },
      fixed: { '/p': page('/t~') },
    });
    const b = served.base;
    const live = site(
      [
        { path: b, links: [`${b}/t~`], facts: { canonical: { href: null } } },
        { path: `${b}/p`, links: [b], facts: { canonical: { href: `${b}/t%7E` } } },
        { path: `${b}/t%7E`, facts: { final_url: `${b}/t~`, canonical: { href: `${b}/t~` } } },
        { path: `${b}/t~`, links: [b], facts: { canonical: { href: `${b}/t~` } } },
      ],
      { homepage: b },
    );
    const p = packetFor(live, b);
    expect(p.verify.expect).toContain(`naming \`${b}/t~\`, spelled so character for character.`);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  // SEO note 5: /p and /p/ are one URL to the command, so a canonical naming the spelling that
  // redirects passed
  it('on a site known to redirect /p to /p/, does not pass a canonical that names /p', async () => {
    served = await servedSite({
      broken: { '/p/': html(tag('/p')) },
      fixed: { '/p/': html(tag('/p/')) },
    });
    const u = (path: string) => `${served!.base}${path}`;
    const input = site(
      [
        { path: served.base, links: [u('/t2')], facts: { canonical: { href: null } } },
        { path: u('/p'), facts: { final_url: u('/p/'), canonical: { href: u('/t') } } },
        { path: u('/t'), status: 404 },
      ],
      { homepage: served.base },
    );
    const p = packetFor(input, served.base);
    expect(p.verify.expect).toContain(
      `naming \`${u('/p/')}\`, however the URL is written but for the slash that ends its path, which counts.`,
    );
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });

  // SEO note 4: `curl -f` stops at 400 and more, so a redirect whose body carries the tag passed
  it('verify is not passed by a redirect whose body carries the expected canonical', async () => {
    const body = html(tag('/p'));
    served = await twoStateSite({
      broken: (_req, res) =>
        void res.writeHead(301, { location: '/elsewhere', 'content-type': 'text/html' }).end(body),
      fixed: (_req, res) => void res.writeHead(200, { 'content-type': 'text/html' }).end(body),
    });
    const p = packetFor(canonicalSite(served.base, 'gone'), served.base);
    const { broken, fixed } = await inBothStates(served, p.verify.command);
    expect(broken.status).not.toBe(0);
    expect(fixed.status).toBe(0);
  });
});
