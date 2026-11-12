import { afterEach, describe, expect, it } from 'vitest';
import {
  closeSites,
  commandOn,
  contentFacts,
  contentCommandOnSites,
  contentPacketProperties,
  contentRecord,
  engineVerdict,
  FIRST_TESTABLE_UA,
  statusesOn,
} from '../test-support/content.js';
import { ld, page } from '../test-support/content-pages.js';
import { writePacket } from '../registry.js';
import { missingAuthorDate, missingAuthorDateSources } from './missing-author-date.js';

const TYPE = 'missing_author_date';

const article = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'Pitching' };
const BODY = '<h1>Pitching a tent</h1><p>Pick flat ground first.</p>';
const DATE = '2026-03-04T09:00:00+00:00';
const BROKEN = page(ld(article), `${BODY}<p>By Jane Doe, the author. Published 4 March 2026.</p>`);
const FIXED = page(
  ld({ ...article, author: { '@type': 'Person', name: 'Jane Doe' }, datePublished: DATE }),
  BODY,
);

afterEach(closeSites);

describe('missing_author_date: what the packet says', () => {
  const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts())!;

  it('states the extent from the record and what the check reads', () => {
    expect(packet.context[0]).toBe(
      'The check for an author and a publication date in markup fails on 2 of the 13 pages of the template `/blog/{slug}` it was decided on.',
    );
    const text = packet.context.join(' ');
    for (const read of [
      '`author`',
      '`datePublished`',
      '`<meta name="author">`',
      '`rel="author"`',
      '`itemprop="author"`',
      '`<meta property="article:published_time">`',
      '`itemprop="datePublished"`',
      '`<time datetime>`',
    ]) {
      expect(text, read).toContain(read);
    }
  });

  it('does not say which of the two is missing: the record does not hold it', () => {
    expect(packet.context.join(' ')).toMatch(/does not record which/);
  });

  it('asks for the real author and date', () => {
    expect(packet.keep.join(' ')).toMatch(/real/);
  });
});

describe('missing_author_date: the command and the engine’s check agree', () => {
  it('fails on the broken page and passes on the fixed one, as the check does', async () => {
    expect(engineVerdict(TYPE, BROKEN)).toBe('fail');
    expect(engineVerdict(TYPE, FIXED)).toBe('pass');
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED });
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
    expect(run.userAgents).toEqual([FIRST_TESTABLE_UA, FIRST_TESTABLE_UA]);
  });

  it('fails on a change that names no author or no date', async () => {
    const person = { '@type': 'Person', name: 'Jane Doe' };
    const lazy: Record<string, string> = {
      '/empty-author': page(ld({ ...article, author: '', datePublished: DATE }), BODY),
      '/no-authors': page(ld({ ...article, author: [], datePublished: DATE }), BODY),
      '/author-only': page(ld({ ...article, author: person }), BODY),
      '/date-only': page(ld({ ...article, datePublished: DATE }), BODY),
      '/date-without-year': page(ld({ ...article, author: person, datePublished: 'soon' }), BODY),
      '/words-in-text': page(
        ld(article),
        `${BODY}<p>"author": "Jane Doe", "datePublished": "2026-03-04" and rel="author" datetime</p>`,
      ),
      '/empty-meta': page(
        `${ld(article)}<meta name="author" content=""><meta property="article:published_time" content="">`,
        BODY,
      ),
      '/on-another-block': page(
        `${ld(article)}${ld({ '@type': 'Product', author: person, datePublished: DATE })}`,
        BODY,
      ),
      '/byline-in-the-footer': page(ld(article), BODY).replace(
        '<footer>',
        `<footer><a rel="author" href="/about">Jane</a><time datetime="${DATE}">4 March</time>`,
      ),
    };
    for (const [path, html] of Object.entries(lazy)) {
      expect(engineVerdict(TYPE, html), path).toBe('fail');
    }
    const statuses = await statusesOn(TYPE, lazy);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('passes on each kind of markup the check reads', async () => {
    const time = `<time datetime="${DATE}">4 March 2026</time>`;
    const fixed: Record<string, string> = {
      '/author-as-text': page(ld({ ...article, author: 'Jane Doe', datePublished: DATE }), BODY),
      '/authors': page(
        ld({ ...article, author: [{ '@type': 'Person', name: 'Jane' }], datePublished: '2026' }),
        BODY,
      ),
      '/pretty': page(ld({ ...article, author: 'Jane Doe', datePublished: DATE }, 2), BODY),
      '/meta': page(
        `${ld(article)}<meta name="author" content="Jane Doe"><meta property="article:published_time" content="${DATE}">`,
        BODY,
      ),
      '/meta-content-first': page(
        `${ld(article)}<meta content="Jane Doe" name="author"><meta content="${DATE}" property="article:published_time">`,
        BODY,
      ),
      // what WordPress's get_the_author_posts_link() returns, beside a time element
      '/byline': page(
        ld(article),
        `${BODY}<p><a href="/author/jane/" rel="author">Jane Doe</a> ${time}</p>`,
      ),
      '/rel-among-others': page(
        ld(article),
        `${BODY}<a rel='nofollow author' href='/jane'>Jane</a> ${time}`,
      ),
      '/microdata': page(
        ld(article),
        `${BODY}<span itemprop="author">Jane Doe</span><meta itemprop="datePublished" content="${DATE}">`,
      ),
      '/mixed': page(ld({ ...article, author: 'Jane Doe' }), `${BODY}${time}`),
      // a `<` in the block's own text, before the author: the block is still one block
      '/less-than-in-headline': page(
        ld({
          headline: 'Tents < 2 kg and <nav>',
          '@type': 'BlogPosting',
          author: 'Jane Doe',
          datePublished: DATE,
        }),
        BODY,
      ),
    };
    for (const [path, html] of Object.entries(fixed)) {
      expect(engineVerdict(TYPE, html), path).toBe('pass');
    }
    const statuses = await statusesOn(TYPE, fixed);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).toBe(0);
  });

  it('reads the same Article types as the check, type by type', async () => {
    const types = [
      'Article',
      'NewsArticle',
      'BlogPosting',
      'LiveBlogPosting',
      'TechArticle',
      'Report',
      'SocialMediaPosting',
      'DiscussionForumPosting',
      'WebPage',
      'Product',
      'Review',
    ];
    const pages = Object.fromEntries(
      types.map((t) => [
        `/${t}`,
        page(ld({ '@type': t, author: 'Jane Doe', datePublished: DATE }), BODY),
      ]),
    );
    expect(engineVerdict(TYPE, pages['/Article']!)).toBe('pass');
    expect(engineVerdict(TYPE, pages['/WebPage']!)).toBe('not_applicable');
    const statuses = await statusesOn(TYPE, pages);
    for (const t of types) {
      expect(statuses[`/${t}`] === 0, t).toBe(engineVerdict(TYPE, pages[`/${t}`]!) === 'pass');
    }
  });
});

describe('missing_author_date: stack bodies', () => {
  it('writes a body for the stacks whose documentation was read, and no other', () => {
    expect(writePacket(TYPE, contentRecord(TYPE), contentFacts())!.frameworks).toEqual([
      'generic',
      'nextjs',
      'wordpress',
    ]);
  });

  it('writes the WordPress body first on a WordPress site', () => {
    const facts = contentFacts();
    const wp = writePacket(TYPE, contentRecord(TYPE), {
      ...facts,
      stack: { ...facts.stack, backend: { cms: 'wordpress', detected_from: 'a test' } },
    })!;
    expect(wp.framework).toBe('wordpress');
    expect(wp.change.join(' ')).toContain('`<?php the_author_posts_link(); ?>`');
  });

  it('says in its first step that the WordPress body assumes a PHP theme, and where a headless site changes', () => {
    const facts = contentFacts();
    const wp = writePacket(TYPE, contentRecord(TYPE), {
      ...facts,
      stack: { ...facts.stack, backend: { cms: 'wordpress', detected_from: 'a test' } },
    })!;
    expect(wp.change[0]).toBe(
      'These steps assume a WordPress theme with PHP templates renders the page. If the front end is a separate application that reads WordPress as its data source, make the change there, as the generic steps describe.',
    );
  });

  it('cites a documentation page, with the date it was read, for each stack body and for the generic steps', () => {
    if (missingAuthorDate.kind !== 'builder') throw new Error('not a builder');
    const stacks = Object.values(missingAuthorDate.stacks);
    expect(stacks.every((s) => s.sources.length > 0)).toBe(true);
    expect(missingAuthorDateSources.length).toBeGreaterThan(0);
    for (const s of [...missingAuthorDateSources, ...stacks.flatMap((b) => b.sources)]) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.read).toBe('2026-11-12');
      expect(s.supports.length).toBeGreaterThan(10);
    }
  });
});

contentPacketProperties(TYPE);
contentCommandOnSites(
  TYPE,
  { broken: BROKEN, fixed: FIXED },
  {
    printed: /"author"[^]*"datePublished"|"datePublished"[^]*"author"/,
    today: /does not name both an author and a publication date/,
    after: /`author`.*`datePublished`/,
  },
);
