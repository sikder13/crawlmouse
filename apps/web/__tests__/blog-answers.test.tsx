import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getPost } from '../lib/blog/registry';
import { allPostSlugs } from '../lib/blog/posts';
import { ANSWERS, type Drawn } from '../lib/blog/answers';
import { DATASETS } from '../lib/blog/datasets';
import { parse } from './helpers/blog-render';

// D4: each post's direct answer and its "Questions this answers" are written from the post's own
// words, adding no claim and no number. This file is what makes that executable: for every added
// summary and answer, (1) each sentence it lists as its source occurs in the rendered body, (2) every
// number in it occurs in those sources, and (3) every word of three or more letters in it occurs in
// the rendered body. It does not judge whether a paraphrase keeps the source's meaning; that is the
// reviewer's reading, and (1) gives the reviewer the sentence to read it against.

interface Body {
  /** The body's text, element text run together as textContent gives it. */
  flat: string;
  /** Every word of the body, from each text node and from `flat`. */
  words: Set<string>;
  doc: Document;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'");
const WORD = /[a-z][a-z'-]*[a-z]|[a-z]/g;
const wordsOf = (s: string) => (norm(s).match(WORD) ?? []).filter((w) => w.length >= 3);

function body(slug: string): Body {
  const post = getPost(slug)!;
  const doc = parse(renderToStaticMarkup(<post.Body />));
  const flat = squash(doc.body.textContent ?? '');
  const walker = doc.createTreeWalker(doc.body, 4);
  const pieces: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) pieces.push(n.textContent ?? '');
  const words = new Set([...wordsOf(pieces.join(' ')), ...wordsOf(flat)]);
  for (const w of [...words])
    for (const part of w.split(/[-']/)) if (part.length >= 3) words.add(part);
  return { flat, words, doc };
}

// Digits as the research article's own check reads them (research-article-data.test.tsx).
const DIGITS = /\d+(?:[.,]\d+)*%?/g;
const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|hundreds|thousand|thousands|million|dozen|half|twice|double|triple|zero)\b/gi;
const numbersIn = (s: string) => [
  ...(s.match(DIGITS) ?? []),
  ...[...s.matchAll(NUMBER_WORDS)].map((m) => m[1]!.toLowerCase()),
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const states = (hay: string, n: string) =>
  /\d/.test(n)
    ? new RegExp(`(?<![\\d.,])${esc(n)}(?![\\d]|[.,]\\d)`).test(hay)
    : new RegExp(`\\b${n}\\b`, 'i').test(hay);

const sentenceCount = (s: string) => (s.match(/[.!?](?=\s|$)/g) ?? []).length;
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** What a drawn text adds that its post does not hold. Empty when it is drawn from the post. */
function notInPost(d: Drawn, b: Body) {
  const sources = d.from.join(' ');
  return {
    sourcesMissing: d.from.filter((f) => !b.flat.includes(squash(f))),
    numbersNotInSources: numbersIn(d.text).filter((n) => !states(sources, n)),
    wordsNotInBody: [...new Set(wordsOf(d.text))].filter((w) => !b.words.has(w)),
  };
}
const CLEAN = { sourcesMissing: [], numbersNotInSources: [], wordsNotInBody: [] };

const SLUGS = allPostSlugs();

describe('the answers cover the posts', () => {
  it('every post has an entry, and every entry is a post', () => {
    expect(Object.keys(ANSWERS).sort()).toEqual([...SLUGS].sort());
  });
});

describe.each(SLUGS)('%s', (slug) => {
  const a = ANSWERS[slug]!;
  const b = body(slug);

  if (a.summary.kind === 'added') {
    const s = a.summary;
    it('its added summary is 40 to 60 words, drawn from the post', () => {
      expect(wordCount(s.text)).toBeGreaterThanOrEqual(40);
      expect(wordCount(s.text)).toBeLessThanOrEqual(60);
      expect(notInPost(s, b)).toEqual(CLEAN);
    });
    it('its body does not already open with a Quick answer box', () => {
      expect(quickAnswer(b.doc)).toBeNull();
    });
  } else {
    const text = a.summary.text;
    it('its abstract is the Quick answer box its body opens with, verbatim', () => {
      const box = quickAnswer(b.doc);
      expect(box, 'the body opens with a Quick answer box').not.toBeNull();
      expect(text).toBe(box);
    });
  }

  if (a.questions.kind === 'added') {
    const items = a.questions.items;
    it('its questions are 3 to 5, each a question answered in 1 to 3 sentences from the post', () => {
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(5);
      for (const q of items) {
        expect(q.question, q.question).toMatch(/^[A-Z].*\?$/);
        expect(sentenceCount(q.text), q.question).toBeGreaterThanOrEqual(1);
        expect(sentenceCount(q.text), q.question).toBeLessThanOrEqual(3);
        expect(notInPost(q, b), q.question).toEqual(CLEAN);
      }
    });
    it('its body has no FAQ of its own', () => {
      expect(bodyFaqHeading(b.doc)).toBeNull();
      expect(bodyFaqPage(b.doc)).toBeNull();
    });
  } else {
    it('its body ends with its own visible FAQ, which its FAQPage JSON-LD matches', () => {
      expect(bodyFaqHeading(b.doc), 'a visible FAQ heading').not.toBeNull();
      const ld = bodyFaqPage(b.doc);
      expect(ld, 'FAQPage JSON-LD in the body').not.toBeNull();
      for (const q of ld!) expect(b.flat, q).toContain(squash(q));
    });
  }

  if (slug === 'ai-crawler-access-test-2026') {
    // The research article's own wording rules (research-article-data.test.tsx) bind what is said
    // about it here too: no can/cannot-family word, no forecast word, no competitor name.
    it('keeps the research article’s wording rules', () => {
      const prose = [
        a.summary.text,
        ...(a.questions.kind === 'added'
          ? a.questions.items.flatMap((q) => [q.question, q.text])
          : []),
      ].join('\n');
      expect(
        prose.match(
          /\b(can|cannot|can't|can’t|could|couldn't|couldn’t|able|unable|will|won't|won’t|expect|expects|expected)\b/gi,
        ) ?? [],
      ).toEqual([]);
      expect(
        prose.match(
          /\b(screaming ?frog|sitebulb|lumar|deepcrawl|jetoctopus|oncrawl|ahrefs|semrush|moz|yoast)\b/gi,
        ) ?? [],
      ).toEqual([]);
    });
  }
});

describe('Dataset facts are the research post’s own', () => {
  it('names only posts that exist', () => {
    for (const slug of Object.keys(DATASETS)) expect(SLUGS, slug).toContain(slug);
  });

  it.each(Object.entries(DATASETS))(
    '%s: description, dates and size come from its body',
    (slug, d) => {
      const b = body(slug);
      expect(notInPost(d.description, b)).toEqual(CLEAN);
      expect(notInPost(d.size, b)).toEqual(CLEAN);
      expect(wordsOf(d.name).filter((w) => !b.words.has(w))).toEqual([]);
      // Each ISO date is the day the body writes beside it, and the body writes it.
      const LONG = (iso: string) =>
        new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        });
      expect([LONG(d.collected.start), LONG(d.collected.end)]).toEqual([...d.collected.from]);
      for (const f of d.collected.from) expect(b.flat).toContain(f);
    },
  );
});

/** The text of the Quick answer box the body opens with, or null. */
function quickAnswer(doc: Document): string | null {
  const first = doc.body.firstElementChild;
  const label = first?.firstElementChild;
  if (!label || label.textContent !== 'Quick answer') return null;
  return squash(label.nextElementSibling?.textContent ?? '');
}

function bodyFaqHeading(doc: Document): Element | null {
  return (
    [...doc.querySelectorAll('h2')].find((h) =>
      /frequently asked questions/i.test(h.textContent ?? ''),
    ) ?? null
  );
}

/** The question names of the body's FAQPage JSON-LD, or null when it has none. */
function bodyFaqPage(doc: Document): string[] | null {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const v = JSON.parse(s.textContent ?? 'null') as {
      '@type'?: string;
      mainEntity?: { name: string }[];
    };
    if (v?.['@type'] === 'FAQPage') return (v.mainEntity ?? []).map((q) => q.name);
  }
  return null;
}
