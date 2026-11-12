import { afterEach, describe, expect, it } from 'vitest';
import {
  closeSites,
  commandOn,
  contentFacts,
  contentCommandOnSites,
  contentPacketProperties,
  contentRecord,
  engineVerdict,
  FIRST_TESTABLE,
  FIRST_TESTABLE_UA,
  statusesOn,
} from '../test-support/content.js';
import { ld, page as htmlPage } from '../test-support/content-pages.js';
import { writePacket } from '../registry.js';
import {
  missingSchemaDescription,
  missingSchemaDescriptionSources,
  PAGE_TYPES_NAMED,
} from './missing-schema-description.js';

const TYPE = 'missing_schema_description';

const page = (head: string, body = '<h1>Pitching a tent</h1><p>Pick flat ground first.</p>') =>
  htmlPage(head, body);

const article = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'Pitching' };
const BROKEN = page(ld(article));
const FIXED = page(ld({ ...article, description: 'How to pitch a tent on flat ground.' }));

afterEach(closeSites);

describe('missing_schema_description: what the packet says', () => {
  const record = contentRecord(TYPE, {
    affected_urls: ['https://shop.test/blog/a', 'https://shop.test/blog/b'],
    extent: { failing: 2, of: 13, unread: 0 },
  });
  const packet = writePacket(TYPE, record, contentFacts())!;

  it('states the extent and the failing pages from the record', () => {
    expect(packet.context[0]).toBe(
      'The check `schema_with_description` fails on 2 of the 13 pages of the template `/blog/{slug}` it was decided on.',
    );
    expect(packet.context).toContain(
      'Failing pages: `https://shop.test/blog/a`, `https://shop.test/blog/b`.',
    );
  });

  it('says how many pages were not read, when the record holds some', () => {
    const unread = writePacket(
      TYPE,
      { ...record, extent: { failing: 2, of: 13, unread: 4 } },
      contentFacts(),
    )!;
    expect(unread.context).toContain(
      '4 more pages of the template could not be read for this check and are not counted.',
    );
    expect(packet.context.join(' ')).not.toMatch(/could not be read/);
  });

  it('counts the failing pages it does not name', () => {
    const many = contentRecord(TYPE, {
      affected_urls: Array.from({ length: 13 }, (_, i) => `https://shop.test/blog/p${i}`),
    });
    expect(writePacket(TYPE, many, contentFacts())!.context.join('\n')).toMatch(
      /`https:\/\/shop\.test\/blog\/p2` and 10 more pages not shown\./,
    );
  });

  it('claims no grade effect while the check does not count', () => {
    expect(packet.context.at(-1)).toBe(
      'The check does not count towards a grade yet, so this fix moves no grade today.',
    );
  });

  it('names only JSON-LD types the engine’s check accepts, and says an empty description fails', () => {
    expect(PAGE_TYPES_NAMED.length).toBeGreaterThan(2);
    for (const type of PAGE_TYPES_NAMED) {
      expect(engineVerdict(TYPE, page(ld({ '@type': type, description: 'A tent.' }))), type).toBe(
        'pass',
      );
      expect(packet.context.join(' ') + packet.change.join(' ')).toContain(`\`${type}\``);
    }
    expect(packet.change.join(' ')).toMatch(/empty/);
  });

  it('requests the first failing page as a crawler the site serves', () => {
    expect(packet.verify.ua).toBe(FIRST_TESTABLE.token);
    expect(packet.verify.command.startsWith('curl -sS -A ')).toBe(true);
    expect(packet.verify.command).toContain("'https://shop.test/blog/a'");
    expect(packet.verify.command).not.toContain('/blog/b');
  });

  it('refuses a record with no failing page', () => {
    expect(() => writePacket(TYPE, { ...record, affected_urls: [] }, contentFacts())).toThrow(
      /failing page/,
    );
  });
});

describe('missing_schema_description: the command and the engine’s check agree', () => {
  it('fails on the broken page and passes on the fixed one, as the check does', async () => {
    expect(engineVerdict(TYPE, BROKEN)).toBe('fail');
    expect(engineVerdict(TYPE, FIXED)).toBe('pass');
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED });
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
    expect(run.userAgents).toEqual([FIRST_TESTABLE_UA, FIRST_TESTABLE_UA]);
  });

  it('requests as no crawler when the audit recorded none that is served, and says so', async () => {
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED }, 'no_crawler');
    expect(run.command.startsWith("curl -sS 'http://127.0.0.1")).toBe(true);
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
    expect(run.userAgents.every((ua) => ua.startsWith('curl/'))).toBe(true);
    const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts('no_crawler'))!;
    expect(packet.verify.ua).toBe(null);
    expect(packet.verify.expect).toMatch(/curl's own user agent/);
  });

  it('fails on a change that does not describe the page', async () => {
    const lazy: Record<string, string> = {
      '/empty': page(ld({ ...article, description: '' })),
      '/blank': page(ld({ ...article, description: '   ' })),
      '/organization-only': page(ld({ '@type': 'Organization', description: 'A shop.' })),
      '/meta-only': page(`${ld(article)}<meta name="description" content="How to pitch a tent.">`),
      '/word-in-text': page(
        ld(article),
        '<h1>T</h1><p>"description": "a tent" is all it takes.</p>',
      ),
      '/other-script': page(
        `${ld(article)}<script type="application/json">{"@type":"Product","description":"x"}</script>`,
      ),
      '/no-json-ld': page(''),
      // the type in one block and the description in the next script: two blocks, neither passes
      '/split-over-scripts': page(
        `${ld({ ...article, headline: 'a < b' })}<script type="application/ld+json">{"description":"x"}</script>`,
      ),
    };
    for (const html of Object.values(lazy)) expect(engineVerdict(TYPE, html)).toBe('fail');
    const statuses = await statusesOn(TYPE, lazy);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('passes on each way the check reads a described page', async () => {
    const described = { ...article, description: 'How to pitch a tent.' };
    const fixed: Record<string, string> = {
      '/graph': page(ld({ '@graph': [{ '@type': 'WebSite' }, described] })),
      '/type-list': page(ld({ '@type': ['Thing', 'Product'], description: 'A tent.' })),
      '/iri': page(ld({ '@type': 'https://schema.org/Product', description: 'A tent.' })),
      '/pretty': page(ld(described, 2)),
      '/second-block': page(`${ld({ '@type': 'Organization' })}${ld(described)}`),
      '/in-body': page('', `<h1>T</h1><p>Text.</p>${ld(described)}`),
      // a `<` in the block's own text, before its type: the block is still one block
      '/less-than-in-headline': page(
        ld({ headline: 'Tents < 2 kg', '@type': 'BlogPosting', description: 'A tent.' }),
      ),
      '/markup-in-text': page(
        ld({ headline: 'Use <nav> and </p> well', '@type': 'BlogPosting', description: 'A tent.' }),
      ),
    };
    for (const html of Object.values(fixed)) expect(engineVerdict(TYPE, html)).toBe('pass');
    const statuses = await statusesOn(TYPE, fixed);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).toBe(0);
  });

  it('reads the same JSON-LD types as the check, type by type', async () => {
    const types = [
      ...PAGE_TYPES_NAMED,
      'NewsArticle',
      'CollectionPage',
      'FAQPage',
      'SocialMediaPosting',
      'ProductModel',
      'TouristTrip',
      'Vehicle',
      'Organization',
      'WebSite',
      'LocalBusiness',
      'Person',
      'BreadcrumbList',
      'ProductGroup',
      'Offer',
      'Brand',
    ];
    const pages = Object.fromEntries(
      types.map((t) => [`/${t}`, page(ld({ '@type': t, description: 'A tent.' }))]),
    );
    // independently of the command: what the owner's rule says of three of them
    expect(engineVerdict(TYPE, pages['/Product']!)).toBe('pass');
    expect(engineVerdict(TYPE, pages['/Organization']!)).toBe('fail');
    expect(engineVerdict(TYPE, pages['/ProductGroup']!)).toBe('fail');
    const statuses = await statusesOn(TYPE, pages);
    for (const t of types) {
      expect(statuses[`/${t}`] === 0, t).toBe(engineVerdict(TYPE, pages[`/${t}`]!) === 'pass');
    }
  });
});

describe('missing_schema_description: stack bodies', () => {
  it('writes a body for the stacks whose documentation was read, and no other', () => {
    const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts())!;
    expect(packet.frameworks).toEqual(['generic', 'nextjs']);
    expect(
      writePacket(TYPE, contentRecord(TYPE), contentFacts('every_crawler', 'nextjs'))!.framework,
    ).toBe('nextjs');
  });

  it('cites a documentation page, with the date it was read, for each stack body and for the generic steps', () => {
    if (missingSchemaDescription.kind !== 'builder') throw new Error('not a builder');
    const cited = [
      ...missingSchemaDescriptionSources,
      ...Object.values(missingSchemaDescription.stacks).flatMap((s) => s.sources),
    ];
    expect(Object.values(missingSchemaDescription.stacks).every((s) => s.sources.length > 0)).toBe(
      true,
    );
    expect(missingSchemaDescriptionSources.length).toBeGreaterThan(0);
    for (const s of cited) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.read).toBe('2026-11-12');
      expect(s.supports.length).toBeGreaterThan(10);
    }
  });
});

contentPacketProperties(TYPE);
contentCommandOnSites(TYPE, { broken: BROKEN, fixed: FIXED });
