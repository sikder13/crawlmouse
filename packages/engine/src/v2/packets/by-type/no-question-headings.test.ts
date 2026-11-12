import { afterEach, describe, expect, it } from 'vitest';
import { MIN_BODY_WORDS, MIN_HEADINGS, QUESTION_MARK } from '../../content/thresholds.js';
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
import { filler, page } from '../test-support/content-pages.js';
import { writePacket } from '../registry.js';
import { QUESTION_MARKS } from './no-question-headings.js';

const TYPE = 'no_question_headings';

/** A page of prose with three sections under the given headings (each an element, as written). */
const sections = (headings: readonly string[], extra = '') =>
  page('', `<h1>Pitching a tent</h1>${extra}${headings.map((h) => `${h}${filler(60)}`).join('')}`);
const BROKEN = sections([
  '<h2>Choosing a site</h2>',
  '<h2>Staking the corners</h2>',
  '<h3>Packing up</h3>',
]);
const FIXED = sections([
  '<h2>Choosing a site</h2>',
  '<h2>How do you stake the corners?</h2>',
  '<h3>Packing up</h3>',
]);
const PLAIN = ['<h2>Choosing a site</h2>', '<h2>Staking the corners</h2>'];

afterEach(closeSites);

describe('no_question_headings: what the packet says', () => {
  const packet = writePacket(TYPE, contentRecord(TYPE), contentFacts())!;

  it('states the rule with the check’s own numbers', () => {
    const text = packet.context.join(' ');
    expect(text).toContain(`at least ${MIN_HEADINGS} section headings`);
    expect(text).toContain(`at least ${MIN_BODY_WORDS} words`);
  });

  it('names the question marks the check reads, and no other', () => {
    expect(QUESTION_MARK.source).toBe(`[${QUESTION_MARKS.join('')}](?:\\s|$)`);
    for (const mark of QUESTION_MARKS) expect(packet.context.join(' ')).toContain(`\`${mark}\``);
  });

  it('asks for one heading, not a rewrite of the headings', () => {
    expect(packet.change.join(' ')).toMatch(/one `<h2>` or `<h3>`/i);
    expect(packet.keep.join(' ')).toMatch(/other headings/);
  });

  it('writes the generic body alone', () => {
    expect(packet.frameworks).toEqual(['generic']);
  });
});

describe('no_question_headings: the command and the engine’s check agree', () => {
  it('fails on the broken page and passes on the fixed one, as the check does', async () => {
    expect(engineVerdict(TYPE, BROKEN)).toBe('fail');
    expect(engineVerdict(TYPE, FIXED)).toBe('pass');
    const run = await commandOn(TYPE, { broken: BROKEN, fixed: FIXED });
    expect(run.broken.status).not.toBe(0);
    expect(run.fixed.status).toBe(0);
  });

  it('fails on a question that is not an h2 or h3 of the page’s own, after its H1', async () => {
    const lazy: Record<string, string> = {
      '/in-a-paragraph': sections([...PLAIN, '<h2>Packing up</h2><p>How do you pack a tent?</p>']),
      '/in-an-h4': sections([...PLAIN, '<h2>Packing up</h2>', '<h4>How do you pack a tent?</h4>']),
      '/before-the-h1': sections([...PLAIN, '<h2>Packing up</h2>']).replace(
        '<h1>',
        '<h2>Lost?</h2><h1>',
      ),
      '/in-the-footer': sections([...PLAIN, '<h2>Packing up</h2>']).replace(
        '<footer>',
        '<footer><h2>Need help?</h2>',
      ),
      '/in-an-aside': sections([
        ...PLAIN,
        '<h2>Packing up</h2>',
        '<aside><h3>New here?</h3></aside>',
      ]),
      '/mark-inside-a-word': sections([...PLAIN, '<h2>Packing up?no</h2>']),
      '/in-an-attribute': sections([...PLAIN, '<h2 title="Why?">Packing up</h2>']),
    };
    for (const [path, html] of Object.entries(lazy)) {
      expect(engineVerdict(TYPE, html), path).toBe('fail');
    }
    const statuses = await statusesOn(TYPE, lazy);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).not.toBe(0);
  });

  it('passes on each way the check reads a question heading', async () => {
    const fixed: Record<string, string> = {
      '/h3': sections([...PLAIN, '<h3>What goes in the bag?</h3>']),
      '/inline-tags': sections([
        ...PLAIN,
        '<h2 class="t"><a href="#stake">How <em>do</em> you stake it</a>?</h2>',
      ]),
      '/clause': sections([...PLAIN, '<h2>Why peg it? Wind.</h2>']),
      '/upper-case-tags': sections([...PLAIN, '<H2>What goes in the bag?</H2>']),
      '/across-lines': sections([...PLAIN, '<h2>\n  What goes\n  in the bag?\n</h2>']),
      ...Object.fromEntries(
        QUESTION_MARKS.map((m, i) => [`/mark-${i}`, sections([...PLAIN, `<h2>ما هذا${m}</h2>`])]),
      ),
    };
    for (const [path, html] of Object.entries(fixed)) {
      expect(engineVerdict(TYPE, html), path).toBe('pass');
    }
    const statuses = await statusesOn(TYPE, fixed);
    for (const [path, status] of Object.entries(statuses)) expect(status, path).toBe(0);
  });

  it('does not set aside what an attribute marks as chrome, and its packet says so', async () => {
    const html = sections([
      ...PLAIN,
      '<h2>Packing up</h2><div role="navigation"><h2>Lost?</h2></div>',
    ]);
    expect(engineVerdict(TYPE, html)).toBe('fail');
    expect((await statusesOn(TYPE, { '/role': html }))['/role']).toBe(0);
    expect(writePacket(TYPE, contentRecord(TYPE), contentFacts())!.verify.expect).toContain(
      'but not `[role="navigation"], [aria-hidden="true"]`',
    );
  });
});

contentPacketProperties(TYPE);
contentCommandOnSites(
  TYPE,
  { broken: BROKEN, fixed: FIXED },
  {
    printed: /^<h[23]>[^<]*\?$/m,
    today: /found none after the H1 with a clause that ends in a question mark/,
    after: /one of them .* question mark/,
  },
);
