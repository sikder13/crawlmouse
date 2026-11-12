import { afterEach, describe, expect, it } from 'vitest';
import {
  ANSWER_SENTENCE_WORDS,
  MIN_BLOCK_WORDS,
  MIN_BODY_WORDS,
  OPENING_WORDS,
} from '../../content/thresholds.js';
import {
  closeSites,
  commandOn,
  contentFacts,
  contentCommandOnSites,
  contentPacketProperties,
  contentRecord,
  engineVerdict,
  statusesOn,
} from '../test-support/content.js';
import { filler, ld, page, words } from '../test-support/content-pages.js';
import { writePacket } from '../registry.js';

const TYPE = 'quotable_opening';

/** 14 words, ending in a full stop. */
const ANSWER = 'A dome tent stands without guy lines because two crossed poles hold its shape.';
/** The page's body after its H1: `opening`, then prose that holds no answer. */
const prose = (opening: string, head = '') =>
  page(head, `<h1>Why a dome tent stands</h1>${opening}${filler(90)}${filler(90)}`);

const BROKEN = prose('<p>4 March 2026</p><p>Ready to pitch? Let us begin right now!</p>');
const FIXED = prose(`<p>4 March 2026</p><p>${ANSWER}</p>`);

afterEach(closeSites);

describe('quotable_opening: what the packet says', () => {
  const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts())!;

  it('states the rule with the check’s own numbers', () => {
    const text = packet.context.join(' ');
    expect(text).toContain(`the first ${OPENING_WORDS} words after the H1`);
    expect(text).toContain(
      `a sentence of ${ANSWER_SENTENCE_WORDS.min} to ${ANSWER_SENTENCE_WORDS.max} words that ends in a full stop`,
    );
    expect(text).toContain(`at least ${MIN_BLOCK_WORDS} words`);
    expect(text).toContain(`at least ${MIN_BODY_WORDS} words`);
    expect(packet.change.join(' ')).toContain(
      `${ANSWER_SENTENCE_WORDS.min} to ${ANSWER_SENTENCE_WORDS.max} words`,
    );
  });

  it('quotes nothing from the pages: the record holds no page text', () => {
    expect(packet.context[0]).toBe(
      'The check for a quotable opening sentence fails on 2 of the 13 pages of the template `/blog/{slug}` it was decided on.',
    );
    expect(packet.keep.join(' ')).toMatch(/already says/);
  });

  it('writes the generic body alone', () => {
    expect(packet.frameworks).toEqual(['generic']);
  });
});

describe('quotable_opening: the command and the engine’s check agree', () => {
  it('fails on the broken page and passes on the fixed one, as the check does', async () => {
    expect(engineVerdict(TYPE, BROKEN)).toBe('fail');
    expect(engineVerdict(TYPE, FIXED)).toBe('pass');
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED });
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
  });

  it('fails on an opening the check does not accept', async () => {
    const lazy: Record<string, string> = {
      '/in-a-list-item': prose(`<ul><li>${ANSWER}</li></ul>`),
      '/after-the-opening': prose(`${filler(90)}${filler(70)}<p>${ANSWER}</p>`),
      '/exclaimed': prose(`<p>${ANSWER.replace(/\.$/, '!')}</p>`),
      '/asked': prose(`<p>${ANSWER.replace(/\.$/, '?')}</p>`),
      '/too-short': prose('<p>Dome tents stand up by themselves.</p>'),
      '/too-long': prose(`<p>${words(ANSWER_SENTENCE_WORDS.max + 1)}.</p>`),
      '/no-full-stop': prose(`<p>${ANSWER.replace(/\.$/, '')}</p>`),
      '/in-an-aside': prose(`<aside><p>${ANSWER}</p></aside>`),
      '/before-the-h1': prose('').replace('<h1>', `<p>${ANSWER}</p><h1>`),
      '/in-the-meta-description': prose('', `<meta name="description" content="${ANSWER}">`),
      '/outside-a-block': prose(`<div>${ANSWER}</div>`),
    };
    for (const [path, html] of Object.entries(lazy)) {
      expect(engineVerdict(TYPE, html), path).toBe('fail');
    }
    const statuses = await statusesOn(TYPE, lazy);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('passes on each opening the check accepts', async () => {
    const fixed: Record<string, string> = {
      '/inline-tags': prose(
        `<p class="lead">A <strong>dome tent</strong> stands without guy lines because two <a href="/poles">crossed poles</a> hold its shape.</p>`,
      ),
      '/second-sentence': prose(`<p>Short one. ${ANSWER}</p>`),
      '/after-a-question': prose(`<p>Why does it stand? ${ANSWER} More follows</p>`),
      '/quoted': prose(`<blockquote>“${ANSWER}”</blockquote>`),
      '/bracketed': prose(`<p>(${ANSWER})</p>`),
      '/across-lines': prose(`<p>\n  ${ANSWER.replace(/ /g, '\n  ')}\n</p>`),
      '/in-a-list-item-paragraph': prose(`<ul><li><p>${ANSWER}</p></li></ul>`),
      '/in-the-block-that-reaches-the-bound': prose(
        `${filler(OPENING_WORDS - 10)}<p>${ANSWER}</p>`,
      ),
      '/upper-case-tags': prose(`<P>${ANSWER}</P>`),
      '/shortest': prose(`<p>${words(ANSWER_SENTENCE_WORDS.min)}.</p>`),
      '/longest': prose(`<p>${words(ANSWER_SENTENCE_WORDS.max)}.</p>`),
    };
    for (const [path, html] of Object.entries(fixed)) {
      expect(engineVerdict(TYPE, html), path).toBe('pass');
    }
    const statuses = await statusesOn(TYPE, fixed);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).toBe(0);
  });

  it('draws the line where the check does, one word either side of each bound', async () => {
    const at = (n: number) => prose(`<p>${words(n)}.</p>`);
    const pages = {
      '/min-1': at(ANSWER_SENTENCE_WORDS.min - 1),
      '/min': at(ANSWER_SENTENCE_WORDS.min),
      '/max': at(ANSWER_SENTENCE_WORDS.max),
      '/max+1': at(ANSWER_SENTENCE_WORDS.max + 1),
      '/reached': prose(`${filler(OPENING_WORDS)}<p>${ANSWER}</p>`),
      '/not-reached': prose(`${filler(OPENING_WORDS - 1)}<p>${ANSWER}</p>`),
    };
    expect(Object.values(pages).map((html) => engineVerdict(TYPE, html))).toEqual([
      'fail',
      'pass',
      'pass',
      'fail',
      'fail',
      'pass',
    ]);
    const statuses = await statusesOn(TYPE, pages);
    expect(Object.values(statuses).map((s) => s === 0)).toEqual([
      false,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('is not applicable to a product page, which the packet says', () => {
    expect(engineVerdict(TYPE, prose(`<p>${ANSWER}</p>`, ld({ '@type': 'Product' })))).toBe(
      'not_applicable',
    );
    expect(writePacket(TYPE, contentRecord(TYPE), contentFacts())!.context.join(' ')).toContain(
      'no `Product` JSON-LD',
    );
  });
});

contentPacketProperties(TYPE);
contentCommandOnSites(TYPE, { broken: BROKEN, fixed: FIXED });
