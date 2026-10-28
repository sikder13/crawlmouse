import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeepBar } from '../../components/v2/screens/result/KeepBar';
import { SiteFooter } from '../../components/v2/SiteFooter';
import {
  FOOTER_COLUMNS,
  FOOTER_COPY,
  MARKETING_NAV,
  SUPPORT_EMAIL,
  isGroup,
} from '../../components/v2/footer-links';
import { RESULT_PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/screens';
import {
  COPY_CHANGES,
  applyChanges,
  withoutAddedText,
  type LockedScreen,
} from '../../lib/v2/copy-registry';
import { findCheck, fixture } from '../../lib/v2/fixtures';
import { EDGE_PILL } from '../../lib/v2/sentences';
import { CHECKS, LOCKED_CRAWL_MOMENT, recording } from '../../lib/v2/recordings';
import { WEB_ROOT } from './_lib/tokens-css';
import { RESULT_NAMES, crawlElement, homeData, homeElement, resultElement } from './_lib/screens';

const locked = (screen: string) =>
  readFileSync(join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', screen), 'utf8');

const decode = (s: string) =>
  s
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const squash = (s: string) => s.replace(/[●▲■○]/g, '').replace(/\s+/g, '');

/**
 * The characters a sighted reader sees, in order, with whitespace removed: element boundaries and
 * line breaks in the source differ between the locked HTML and JSX. Spacing is checked separately,
 * on the rendered pages, by tests/visual/copy.spec.ts. Typed status glyphs are dropped from the
 * locked side because the build draws them (decision i); screen-reader-only text is dropped from
 * both sides; the locked canvas's second state of a toggled block (`sc-if + sc-if`) is dropped,
 * since the page opens with the first.
 */
function lockedText(html: string): string {
  const body = html.slice(html.indexOf('</helmet>'), html.indexOf('</x-dc>'));
  return squash(
    decode(
      body
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/(<\/sc-if>\s*)<sc-if [^>]*>[\s\S]*?<\/sc-if>/g, '$1')
        .replace(/<label [^>]*left:-9999px[^>]*>[^<]*<\/label>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ''),
    ),
  );
}

/**
 * What we render, read the same way, leaving out what the brief adds (`data-v2-addition`, and the
 * evidence class beside a verdict, `data-v2-evidence`): those are listed in ADDITIONS instead.
 */
function renderedText(markup: string, screen?: LockedScreen): string {
  const doc = new JSDOM(`<body>${markup}</body>`).window.document;
  doc
    .querySelectorAll('svg, [data-v2-sr-only], [data-v2-addition], [data-v2-evidence]')
    .forEach((el) => el.remove());
  const text = doc.body.textContent ?? '';
  return squash(screen ? withoutAddedText(text, screen) : text);
}

/** The locked text with the registry's changes for `screen` applied, read as lockedText reads. */
const expected = (html: string, screen: LockedScreen) =>
  applyChanges(lockedText(html), screen, squash);

/** The first point where two texts part, with context, for a readable failure. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n  locked:   …${a.slice(Math.max(0, i - 40), i + 60)}\n  rendered: …${b.slice(Math.max(0, i - 40), i + 60)}`;
}

const STATE_OF_CLASS = { ok: 'ok', warn: 'warn', bad: 'bad', neu: 'neutral' } as const;

/** Each status pill in a locked screen: its state (from the class), glyph and label, in order. */
function lockedPills(html: string) {
  return [...html.matchAll(/<span class="st (ok|warn|bad|neu)">([^<]*)<\/span>/g)].map((m) => {
    const text = (m[2] ?? '').trim();
    const glyph = /^[●▲■○]/.test(text) ? text.charAt(0) : null;
    return {
      state: STATE_OF_CLASS[m[1] as keyof typeof STATE_OF_CLASS],
      glyph,
      label: glyph ? text.slice(1).trim() : text,
    };
  });
}

/** Each status pill we render: its state, the glyph it draws, and its visible label, in order. */
function renderedPills(markup: string) {
  return [
    ...markup.matchAll(
      /data-v2-pill="(\w+)">(?:<svg[^>]*data-v2-glyph-char="(.)"[\s\S]*?<\/svg>)?(?:<span [^>]*data-v2-sr-only=""[^>]*>[^<]*<\/span>)?([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ state: m[1], glyph: m[2] ?? null, label: decode(m[3] ?? '').trim() }));
}

/**
 * The site header's primary navigation and the footer. CC-21b changed both from the lock on
 * purpose (the Learn menu, the full footer), so the lock comparison leaves them out on both sides
 * and the test below checks them against components/v2/footer-links.ts instead. Keyed on the
 * `aria-label="Primary"` both the lock and the build give that nav, so the footer's own nav,
 * labelled "Footer", is cut with the footer and not on its own.
 */
const SHELL = [
  /<nav\b[^>]*aria-label="Primary"[^>]*>[\s\S]*?<\/nav>/g,
  /<footer\b[\s\S]*?<\/footer>/g,
];

function withoutShell(markup: string): { rest: string; cut: string[] } {
  const cut: string[] = [];
  let rest = markup;
  for (const re of SHELL) {
    rest = rest.replace(re, (m) => {
      cut.push(m);
      return '';
    });
  }
  return { rest, cut };
}

/** The header navigation's text, built from the map: each label, and a group's items after it. */
const navFromMap = () =>
  MARKETING_NAV.flatMap((e) => (isGroup(e) ? [e.label, ...e.items.map((i) => i.label)] : [e.label]))
    .join('')
    .replace(/\s+/g, '');

/** The footer's visible text, built from the map and its copy, in reading order. */
const footerFromMap = () =>
  [
    'crawlmouse',
    FOOTER_COPY.line,
    FOOTER_COPY.company,
    SUPPORT_EMAIL,
    'Copy address',
    `© ${new Date().getFullYear()}`,
    ...FOOTER_COLUMNS.flatMap((c) => [c.title, ...c.items.map((i) => i.label)]),
  ]
    .join('')
    .replace(/\s+/g, '');

const splitAtKeep = (s: string, marker: string) => {
  const at = s.indexOf(marker);
  if (at < 0) throw new Error(`no ${marker}`);
  return [s.slice(0, at), s.slice(at)] as const;
};

describe('Final-Home', () => {
  const html = renderToStaticMarkup(homeElement());

  it('has exactly one orange element: the hero "Start the audit" (rule 3, decision 2)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Start the audit$/);
  });

  it('reads as the locked HTML, outside the shell, with each registered change and nothing else', () => {
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Home.dc.html')).rest, 'home'),
        renderedText(withoutShell(html).rest),
      ),
    ).toBeNull();
  });

  it('leaves out of the lock comparison exactly the locked nav and footer, and nothing else', () => {
    const lockedCut = withoutShell(locked('Final-Home.dc.html')).cut;
    expect(lockedCut.map((c) => lockedText(`</helmet>${c}</x-dc>`))).toEqual([
      'ProductForagenciesDevelopersPricing',
      'NahlTechnologiesInc.·IndianapolisDocsStatusPrivacyTermssupport@crawlmouse.com',
    ]);
    const ours = withoutShell(html).cut;
    expect(ours).toHaveLength(2);
    expect(ours[0]).toMatch(/^<nav [^>]*aria-label="Primary"/);
    expect(ours[1]).toMatch(/^<footer/);
  });

  it('renders the header navigation and the footer from footer-links.ts', () => {
    const [nav, footer] = withoutShell(html).cut;
    expect(renderedText(nav ?? '')).toBe(navFromMap());
    expect(renderedText(footer ?? '')).toBe(footerFromMap());
  });

  it('draws each crawler cell in the locked state, except where FACTS I2 makes a challenge ○', () => {
    const want = lockedPills(locked('Final-Home.dc.html')).map((p) =>
      p.label === 'challenge'
        ? { state: 'unverified', glyph: '○' }
        : { state: p.state, glyph: p.glyph },
    );
    const got = renderedPills(html).map(({ state, glyph }) => ({ state, glyph }));
    expect(want.length).toBe(8);
    expect(got).toEqual(want);
  });

  it('gives every verdict cell its evidence class, from the fixture', () => {
    const evidence = [...html.matchAll(/data-v2-evidence="(\w+)"/g)].map((m) => m[1]);
    expect(evidence).toEqual(['declared', 'declared', ...Array(6).fill('simulated')]);
  });

  it('computes the share of words a crawler reads from the two counts', () => {
    const { withoutJs } = homeData();
    expect(withoutJs.share).toBe(Math.round((withoutJs.botWords / withoutJs.browserWords) * 100));
    expect(renderedText(html)).toContain(`words·${withoutJs.share}%`);
  });
});

describe('Final-Result, the bad site', () => {
  const html = renderToStaticMarkup(resultElement('bad-site'));
  const data = RESULT_PREVIEWS['bad-site']();

  it('has exactly one orange element: "Open the fix" (rule 3)', () => {
    const primaries = html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toMatch(/>Open the fix$/);
  });

  it.each(['Final-Result.dc.html', 'Final-Result-Dark.dc.html'])(
    'reads as %s above the keep bar, with each registered change and nothing else',
    (file) => {
      const [lockedMain] = splitAtKeep(locked(file), '<div id="keep"');
      const [ourMain] = splitAtKeep(html, '<div id="keep"');
      expect(
        firstDifference(expected(lockedMain + '</x-dc>', 'result'), renderedText(ourMain)),
      ).toBeNull();
    },
  );

  it('registers each change to the locked Result under the kind its source names', () => {
    const result = COPY_CHANGES.filter((c) => c.screen === 'result');
    expect(result.length).toBeGreaterThan(10);
    for (const c of result) {
      expect(c.source, c.locked).toMatch(
        c.kind === 'facts' ? /^FACTS / : /^(The fixture|As on Home)/,
      );
    }
  });

  it('shows the locked keep bar copy, open and dismissed: same characters, same order', () => {
    const [, lockedBar] = splitAtKeep(locked('Final-Result.dc.html'), '<div id="keep"');
    const ifs = [...lockedBar.matchAll(/<sc-if [^>]*>([\s\S]*?)<\/sc-if>/g)].map((m) => m[1] ?? '');
    expect(ifs).toHaveLength(2);
    const bar = (state: 'open' | 'dismissed') =>
      renderedText(
        renderToStaticMarkup(
          <KeepBar domain={data.domain} expires={data.keptUntil!} initial={state} />,
        ),
      );
    expect(firstDifference(lockedText(`</helmet>${ifs[0]}</x-dc>`), bar('open'))).toBeNull();
    expect(firstDifference(lockedText(`</helmet>${ifs[1]}</x-dc>`), bar('dismissed'))).toBeNull();
  });

  it('draws each status pill in the locked state and glyph, in order', () => {
    const want = lockedPills(locked('Final-Result.dc.html')).map(({ state, glyph }) => ({
      state,
      glyph,
    }));
    expect(want.length).toBeGreaterThan(5);
    expect(renderedPills(html).map(({ state, glyph }) => ({ state, glyph }))).toEqual(want);
  });

  it('ends with the site footer, after the keep bar, the same footer the shell renders', () => {
    const { cut } = withoutShell(html);
    expect(cut).toHaveLength(1);
    expect(renderedText(cut[0] ?? '')).toBe(footerFromMap());
    expect(html).toContain(renderToStaticMarkup(<SiteFooter />));
    expect(html.indexOf('<footer')).toBeGreaterThan(html.indexOf('<div id="keep"'));
    expect(withoutShell(locked('Final-Result.dc.html')).cut).toEqual([]);
  });

  it('renders the keep bar hidden until the reader scrolls (scroll-gated)', () => {
    const initial = renderToStaticMarkup(<KeepBar domain="x.com" expires="26 Oct, 02:34 UTC" />);
    expect(initial).toContain('data-v2-keep="waiting"');
    expect(renderedText(initial)).toBe('');
  });

  it('reconciles the fix counts: rows, headline, pills and the doors all agree', () => {
    const fixes = data.fixes!;
    expect(fixes.rows.reduce((n, r) => n + r.count, 0)).toBe(fixes.total);
    expect(fixes.rows.filter((r) => r.open).length).toBe(fixes.open);
    expect(fixes.open + fixes.pro).toBe(fixes.total);
    const perDoor = data.doors.map((d) => {
      const open = /(\d+) fix(?:es)? open/.exec(d.footer);
      const pro = /(\d+) on Pro/.exec(d.footer);
      return [Number(open?.[1] ?? 0), Number(pro?.[1] ?? 0)];
    });
    expect(perDoor.reduce((n, [o]) => n + o!, 0)).toBe(fixes.open);
    expect(perDoor.reduce((n, [, p]) => n + p!, 0)).toBe(fixes.pro);
  });
});

describe('the other Result variants and states', () => {
  // Loading offers the reader nothing to do yet, so it has no orange element; every other state
  // has one, the reader's way forward.
  it.each(RESULT_NAMES)('%s has the one orange element its reader can act on', (name) => {
    const html = renderToStaticMarkup(resultElement(name));
    expect(html.match(/data-v2-primary=""/g) ?? []).toHaveLength(name === 'loading' ? 0 : 1);
  });

  it('shows the clean bill: no fixes table, every crawler with its evidence, no competitor number', () => {
    const html = renderToStaticMarkup(resultElement('clean'));
    const text = renderedText(html);
    expect(text).not.toContain('inorderofimpact');
    expect(html.match(/data-v2-verdict="allowed"/g)).toHaveLength(8);
    expect(html.match(/data-v2-evidence="declared"/g)).toHaveLength(2);
    const offer = /Isacompetitorthisreadable\?.*?Keepthisaudit,start14daysofPro/.exec(
      squash(new JSDOM(html).window.document.body.textContent ?? ''),
    );
    expect(offer).not.toBeNull();
    expect(offer![0].replace(/14days/g, '')).not.toMatch(/\d/);
    // Nobody has kept it, so watching has not started: the card offers to start it.
    expect(html.match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g)).toEqual([
      expect.stringMatching(/>Watch this site$/),
    ]);
  });

  /** The header's actions: each link's text, and its title when it has one. */
  const headerActions = (name: (typeof RESULT_NAMES)[number]) => {
    const doc = new JSDOM(renderToStaticMarkup(resultElement(name))).window.document;
    return [...doc.querySelectorAll('header a, header button')]
      .filter((e) => e.textContent !== 'crawlmouse')
      .map((e) =>
        e.getAttribute('title') ? `${e.textContent} (${e.getAttribute('title')})` : e.textContent,
      );
  };

  it('offers in its header what each state can do: share and re-run a result, re-run a failed or expired audit', () => {
    const share = (until: string) => `Share (The link lasts as long as this audit: until ${until})`;
    expect(Object.fromEntries(RESULT_NAMES.map((n) => [n, headerActions(n)]))).toEqual({
      'bad-site': [share('26 Oct, 02:34 UTC'), 'Re-run, free', 'Log in'],
      clean: [share('28 Oct, 15:31 UTC'), 'Re-run, free', 'Log in'],
      challenged: ['Share', 'Re-run, free', 'Log in'],
      loading: ['Log in'],
      empty: ['Log in'],
      error: ['Re-run, free', 'Log in'],
      expired: ['Re-run, free', 'Log in'],
    });
  });

  it('says how long a share link lasts only on a result nobody has kept, and never as a fixed 24 hours', () => {
    for (const name of RESULT_NAMES) {
      expect(renderToStaticMarkup(resultElement(name)), name).not.toContain('24 hours');
    }
    const challenged = renderToStaticMarkup(resultElement('challenged'));
    expect(challenged).not.toContain('The link lasts');
  });

  it.each(['bad-site', 'clean', 'challenged'] as const)(
    '%s draws a coverage line on each of its doors, as the view gives it',
    (name) => {
      const data = RESULT_PREVIEWS[name]();
      if (data.state !== 'result') throw new Error('Not a result');
      const doc = new JSDOM(renderToStaticMarkup(resultElement(name))).window.document;
      const lines = [...doc.querySelectorAll('[data-v2-coverage]')].map((e) => e.textContent);
      expect(lines).toHaveLength(data.doors.length);
      data.doors.forEach((d, i) => {
        if ('read' in d.coverage) expect(lines[i]).toBe(d.coverage.read);
        else expect(lines[i]).toMatch(new RegExp(`^Tested ${d.coverage.pages.tested} of `));
      });
    },
  );

  it('withholds AI readability with the access range, and keeps Technical SEO', () => {
    const data = RESULT_PREVIEWS.challenged();
    expect(data.grades[0]).toMatchObject({ letter: 'C+', score: 67, withheld: false });
    expect(data.grades[1]).toMatchObject({ letter: null, score: null, withheld: true });
    expect(data.grades[1].summary).toContain('between 0 and 30 of 40');
    expect(data.doors[0]!.pill.label).toBe('blocks all automation');
    const html = renderToStaticMarkup(resultElement('challenged'));
    expect(html).toContain('data-v2-grade-withheld');
    expect(html).toContain('data-v2-evidence="observed"');
  });

  it('builds each state’s copy from its check', () => {
    expect(renderedText(renderToStaticMarkup(resultElement('empty')))).toContain(
      'queuedon2Nov2026,11:59UTC',
    );
    expect(renderedText(renderToStaticMarkup(resultElement('error')))).toContain(
      squash('robots.txt and the homepage both timed out behind the edge challenge'),
    );
    expect(renderedText(renderToStaticMarkup(resultElement('expired')))).toContain(
      'until28Oct2026,15:31UTC',
    );
  });
});

describe('Final-Crawl', () => {
  const at = (ms: string) => renderToStaticMarkup(crawlElement('bad-site', ms));

  it('reads as the locked HTML at its moment, with each registered change and nothing else', () => {
    const html = at(String(LOCKED_CRAWL_MOMENT.at_ms));
    expect(
      firstDifference(
        expected(withoutShell(locked('Final-Crawl.dc.html')).rest, 'crawl'),
        renderedText(withoutShell(html).rest, 'crawl'),
      ),
    ).toBeNull();
  });

  it('has no orange element while it runs, and one, the result button, after the reveal', () => {
    expect(at('47000').match(/data-v2-primary=""/g)).toBeNull();
    const end = at('end').match(/<[^>]*data-v2-primary=""[^>]*>[^<]*/g) ?? [];
    expect(end).toHaveLength(1);
    expect(end[0]).toMatch(/>See the full result$/);
  });

  it('prints no percentage while it runs: the bar is pages crawled of the estimate, said in words', () => {
    for (const ms of ['3000', '20000', '47000', '70000']) {
      const html = at(ms);
      const panel = /<div[^>]*role="progressbar"[^>]*>/.exec(html)![0];
      const text = renderedText(html.slice(0, html.indexOf('Recent fetches')));
      expect(text).not.toContain('%');
      expect(panel).toMatch(/aria-valuetext="\d+ of about \d+ pages"/);
    }
  });

  it('draws no bar before the estimate lands, nothing full and nothing to fill (D3)', () => {
    const first = recording('bad-site').events.find((e) => e.type === 'pages_estimated')!;
    for (const ms of [0, 1000, first.at_ms - 1]) {
      const html = at(String(ms));
      expect(html).not.toContain('role="progressbar"');
      const panel = html.slice(0, html.indexOf('Found so far'));
      expect(panel).not.toMatch(/scaleX\(/);
    }
    expect(at(String(first.at_ms))).toContain('role="progressbar"');
  });

  it('ends with the bar full when every page was crawled, and at its share when the crawl was cut', () => {
    const full = /<div[^>]*role="progressbar"[^>]*>/.exec(at('end'))![0];
    expect(full).toMatch(/aria-valuenow="214"/);
    expect(full).toMatch(/aria-valuemax="214"/);
    const cut = renderToStaticMarkup(crawlElement('challenged-site', 'end'));
    const { coverage } = findCheck(fixture('challenged-site'), CHECKS.challengedFirstAudit);
    const bar = /<div[^>]*role="progressbar"[^>]*>/.exec(cut)![0];
    expect(bar).toContain(`aria-valuenow="${coverage!.pages_crawled}"`);
    expect(bar).toContain(`aria-valuemax="${coverage!.pages_discovered}"`);
    expect(coverage!.pages_crawled).toBeLessThan(coverage!.pages_discovered);
  });

  it('stops saying the audit is running once it has ended', () => {
    const running = renderedText(at('47000'));
    const saysRunning = ['Auditing', 'Cancel this audit', 'the result keeps building'].map(squash);
    for (const said of saysRunning) expect(running).toContain(said);
    for (const name of ['bad-site', 'challenged-site'] as const) {
      const end = renderedText(renderToStaticMarkup(crawlElement(name, 'end')));
      for (const said of saysRunning) expect(end).not.toContain(said);
      expect(end).toContain(squash('Audited'));
      expect(end).toContain(squash('The result is ready.'));
    }
  });

  it('holds the six AI crawlers’ verdict panel from the start, waiting until the crawler tests', () => {
    const panel = (html: string) =>
      /<div[^>]*>(?=<div[^>]*>What each AI crawler gets)/.exec(html)![0];
    const crawling = at('47000');
    expect(panel(crawling)).toContain('data-v2-waiting');
    expect(crawling.match(/not tested yet/g)).toHaveLength(6);
    const testing = at('72000');
    expect(panel(testing)).not.toContain('data-v2-waiting');
    expect(at('end').match(/data-v2-verdict=/g)).toHaveLength(6);
  });

  it('announces the grades once they land, to a screen reader as to the eye', () => {
    const status = (html: string) =>
      new JSDOM(`<body>${html}</body>`).window.document.querySelector('[data-v2-announce]');
    expect(status(at('47000'))?.textContent).toBe('');
    const said = status(at('end'))?.textContent ?? '';
    expect(said).toContain('Finished in 2:11');
    expect(said).toContain('Technical SEO B, 79 of 100');
    expect(said).toContain('AI readability D, 41 of 100');
    const withheld = status(renderToStaticMarkup(crawlElement('challenged-site', 'end')));
    expect(withheld?.textContent).toContain('AI readability withheld');
  });

  it('reveals the grades once, at the end, in place of the email ask', () => {
    expect(at('125000')).not.toContain('See the full result');
    const end = at('end');
    expect(end).toContain('data-v2-grade=""');
    expect(end).not.toContain('Email me the result');
  });
});

describe('the edge that blocks all automation, as rendered', () => {
  it('is said in the access pill’s wording on the challenged pages, crawler cells included', () => {
    for (const html of [
      renderToStaticMarkup(resultElement('challenged')),
      renderToStaticMarkup(crawlElement('challenged-site', 'end')),
    ]) {
      expect(html).toContain(EDGE_PILL);
      expect(html).not.toMatch(/\brefused\b|lets through|challenges every|whoever we said/);
    }
  });
});

describe('the copy registry', () => {
  it('names a source for every change, and changes something', () => {
    for (const c of COPY_CHANGES) {
      expect(c.source.length, c.locked).toBeGreaterThan(5);
      expect(squash(c.locked)).not.toBe(squash(c.rendered));
    }
  });
});
