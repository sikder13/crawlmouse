import { describe, expect, it } from 'vitest';
import { CHALLENGE_MARKERS, CHALLENGE_TITLES, challengeIn } from './challenge.js';
import { measurePage } from './page.js';

const page = (main: string, title = 'A page') =>
  `<html><head><title>${title}</title></head><body><main>${main}</main></body></html>`;

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('a measured page', () => {
  it('carries both counts, the share and the state', () => {
    expect(
      measurePage({
        staticHtml: page(`<p>${words(25)}</p>`),
        renderedHtml: page(`<p>${words(100)}</p>`),
        previous: null,
      }),
    ).toEqual({
      measured: true,
      without_js: { raw_words: 25, rendered_words: 100, text_share: 0.25, state: 'empty_shell' },
    });
  });

  it('uses the previous check’s state for the hysteresis', () => {
    const input = {
      staticHtml: page(`<p>${words(40)}</p>`),
      renderedHtml: page(`<p>${words(100)}</p>`),
    };
    expect(measurePage({ ...input, previous: null })).toMatchObject({
      without_js: { state: 'partial' },
    });
    expect(measurePage({ ...input, previous: 'empty_shell' })).toMatchObject({
      without_js: { state: 'empty_shell' },
    });
  });
});

describe('a page that is not measured', () => {
  it('is nothing_rendered when the rendered side has no words, even if the static side has some', () => {
    expect(
      measurePage({
        staticHtml: page('<p>some words</p>'),
        renderedHtml: page(''),
        previous: null,
      }),
    ).toEqual({ measured: false, reason: 'nothing_rendered' });
  });

  it('is challenged when the rendered side is a challenge page, not a share of its words', () => {
    const challenge =
      '<html><head><title>Just a moment...</title></head><body><p>Checking.</p></body></html>';
    expect(
      measurePage({ staticHtml: page('<p>words</p>'), renderedHtml: challenge, previous: null }),
    ).toEqual({ measured: false, reason: 'challenged' });
  });

  it('is challenged when the static side is a challenge page', () => {
    expect(
      measurePage({
        staticHtml: page('<div id="px-captcha"></div>'),
        renderedHtml: page(`<p>${words(100)}</p>`),
        previous: null,
      }),
    ).toEqual({ measured: false, reason: 'challenged' });
  });
});

describe('challenge pages', () => {
  it.each(CHALLENGE_TITLES)('are recognised by the title %j, in any case', (title) => {
    expect(challengeIn(page('<p>x</p>', title.toUpperCase()))).toBe(true);
  });

  it.each(CHALLENGE_MARKERS)('are recognised by the marker %j in the HTML', (marker) => {
    expect(challengeIn(page(`<div data-x="${marker}"></div>`))).toBe(true);
  });

  it('are not every page Cloudflare serves: its challenge-platform scripts load on ordinary pages', () => {
    const ordinary = page(
      '<p>Real article text.</p><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    );
    expect(challengeIn(ordinary)).toBe(false);
  });

  it('are not a page whose text merely says "just a moment"', () => {
    expect(challengeIn(page('<p>Just a moment... we are loading your cart.</p>'))).toBe(false);
  });
});
