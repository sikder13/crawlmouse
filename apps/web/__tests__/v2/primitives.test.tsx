import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import fc from 'fast-check';
import {
  Button,
  Card,
  CoverageLine,
  coverageText,
  EVIDENCE_CLASSES,
  Field,
  Grade,
  PageShell,
  StatusPill,
  Table,
  VERDICTS,
  VerdictCell,
  type EvidenceClass,
  type PillState,
  type Verdict,
} from '../../components/v2';
import { WEB_ROOT } from './_lib/tokens-css';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const css = (name: string) =>
  readFileSync(join(WEB_ROOT, 'components', 'v2', `${name}.module.css`), 'utf8');
/** The declarations of one rule in a CSS module, whitespace-collapsed. */
const rule = (src: string, selector: string) => {
  const at = src.indexOf(`${selector} {`);
  if (at < 0) return null;
  return src.slice(at, src.indexOf('}', at)).replace(/\s+/g, ' ').trim();
};
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

describe('Button', () => {
  it('renders a type=button <button> by default, not marked primary', () => {
    const out = html(<Button>Re-run, free</Button>);
    expect(out).toMatch(/^<button [^>]*type="button"/);
    expect(out).toContain('data-v2-button="default"');
    expect(out).not.toContain('data-v2-primary');
  });

  it('marks the primary variant so a screen can count its orange elements (rule 3)', () => {
    const out = html(<Button variant="primary">Open the fix</Button>);
    expect(out).toContain('data-v2-primary=""');
    expect(rule(css('Button'), '.primary')).toContain('background: var(--v2-acc)');
    expect(rule(css('Button'), '.primary')).toContain('color: var(--v2-on-acc)');
  });

  it('renders a link when given href, and drops the href when disabled', () => {
    expect(html(<Button href="/pricing">See plans</Button>)).toMatch(/^<a [^>]*href="\/pricing"/);
    const off = html(
      <Button href="/pricing" disabled>
        See plans
      </Button>,
    );
    expect(off).not.toContain('href=');
    expect(off).toContain('aria-disabled="true"');
  });

  it('renders a presentational span with no interactive element', () => {
    const out = html(<Button presentational>Open</Button>);
    expect(out).toMatch(/^<span /);
    expect(out).not.toMatch(/<(a|button)\b/);
  });

  it('shows a keyboard focus ring', () => {
    expect(rule(css('Button'), '.btn:focus-visible')).toContain('outline: 2px solid var(--v2-fg)');
  });
});

describe('StatusPill', () => {
  const glyphStates: PillState[] = ['ok', 'warn', 'bad', 'unverified'];

  it('draws a hidden glyph for each of the four status states', () => {
    for (const state of glyphStates) {
      const out = html(<StatusPill state={state}>200</StatusPill>);
      expect(out, state).toContain(`data-v2-glyph="${state}"`);
      expect(out, state).toMatch(/<svg [^>]*aria-hidden="true"/);
    }
  });

  it('draws the fourth glyph (○, unverified) as a ring, not a filled shape', () => {
    const out = html(<StatusPill state="unverified">challenged</StatusPill>);
    expect(out).toMatch(/<circle [^>]*fill="none"[^>]*stroke="currentColor"/);
  });

  it('gives neutral pills no glyph and no spoken status', () => {
    const out = html(<StatusPill state="neutral">74 / 100</StatusPill>);
    expect(out).not.toContain('<svg');
    expect(textOf(out)).toBe('74 / 100');
  });

  it('names the status for screen readers before the label', () => {
    expect(textOf(html(<StatusPill state="bad">403</StatusPill>))).toBe('Problem: 403');
    expect(textOf(html(<StatusPill state="unverified">challenge</StatusPill>))).toBe(
      'Unverified: challenge',
    );
  });

  it('never types the glyph characters, so no font fallback can change them', () => {
    for (const state of [...glyphStates, 'neutral'] as PillState[]) {
      expect(html(<StatusPill state={state}>x</StatusPill>)).not.toMatch(/[●▲■○]/);
    }
  });
});

describe('Grade', () => {
  it('shows the letter and the score out of 100', () => {
    const out = html(
      <Grade label="Technical SEO" letter="B" score={79}>
        Sound structure.
      </Grade>,
    );
    expect(textOf(out)).toContain('Technical SEO');
    expect(out).toContain('data-v2-grade-letter="B"');
    expect(textOf(out)).toContain('79 / 100');
    expect(textOf(out)).toContain('Sound structure.');
  });

  it('sets the letter in the display face at the locked weight and tracking', () => {
    const r = rule(css('Grade'), '.letter');
    expect(r).toContain('font-family: var(--v2-font-display)');
    expect(r).toContain('font-weight: var(--v2-weight-display)');
    expect(r).toContain('letter-spacing: var(--v2-tracking-display)');
  });

  it('can show a letter in the problem tone', () => {
    expect(html(<Grade label="AI visibility" letter="D" score={41} tone="bad" />)).toContain(
      'data-v2-grade-tone="bad"',
    );
  });

  it('withholds: no letter, no score, and says so in words', () => {
    const out = html(
      <Grade label="AI visibility" withheld>
        Fewer than two scored crawlers were measured.
      </Grade>,
    );
    expect(out).toContain('data-v2-grade-withheld=""');
    expect(out).not.toContain('data-v2-grade-letter');
    expect(textOf(out)).toContain('withheld');
    expect(textOf(out)).not.toMatch(/\d+ \/ 100/);
  });

  it('refuses a withheld grade that still carries a letter or score', () => {
    expect(() => html(<Grade label="x" withheld letter="B" />)).toThrow(/withheld/);
    expect(() => html(<Grade label="x" withheld score={50} />)).toThrow(/withheld/);
  });

  it('refuses a malformed letter or an out-of-range score', () => {
    expect(() => html(<Grade label="x" letter="G" score={50} />)).toThrow(/letter/);
    expect(() => html(<Grade label="x" letter="B" score={101} />)).toThrow(/score/);
    expect(() => html(<Grade label="x" letter="B" score={-1} />)).toThrow(/score/);
    expect(() => html(<Grade label="x" letter="B" />)).toThrow(/score/);
    expect(html(<Grade label="x" letter="A-" score={90} />)).toContain('data-v2-grade-letter="A-"');
  });
});

describe('VerdictCell', () => {
  // The vocabulary is pinned against the facts file, not against the component's own list.
  const facts = readFileSync(
    join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'FACTS-proposed.md'),
    'utf8',
  );
  const line = facts
    .split('\n')
    .find((l) => l.startsWith('Verdict vocabulary (I2), eleven states'));
  // The list runs from "eleven states:" to the first full stop; later sentences repeat some names.
  const list = (line ?? '').split('eleven states:')[1]?.split('. ')[0] ?? '';
  const factsVerdicts = [...list.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

  it('reads eleven verdicts from FACTS-proposed.md', () => {
    expect(factsVerdicts).toHaveLength(11);
  });

  it('covers exactly the FACTS verdict vocabulary, in order', () => {
    expect(Object.keys(VERDICTS)).toEqual(factsVerdicts);
  });

  it('renders every verdict with every evidence class', () => {
    for (const verdict of Object.keys(VERDICTS) as Verdict[]) {
      for (const evidence of Object.keys(EVIDENCE_CLASSES) as EvidenceClass[]) {
        const out = html(<VerdictCell verdict={verdict} evidence={evidence} />);
        expect(out).toContain(`data-v2-verdict="${verdict}"`);
        expect(out).toContain(`data-v2-evidence="${evidence}"`);
        expect(textOf(out)).toContain(VERDICTS[verdict].label);
        expect(textOf(out)).toContain(`Evidence: ${evidence}`);
      }
    }
  });

  it('has exactly the three evidence classes', () => {
    expect(Object.keys(EVIDENCE_CLASSES)).toEqual(['declared', 'simulated', 'observed']);
  });

  it('uses the word "blocked" only for the two verdicts FACTS allows it on', () => {
    const blocked = Object.entries(VERDICTS)
      .filter(([, v]) => /\bblocked\b/i.test(v.label))
      .map(([k]) => k);
    expect(blocked).toEqual(['disallowed_by_robots', 'blocked_by_ua_rule']);
  });

  it('gives the fourth glyph (○) to exactly the challenged and unverified verdicts, worded as FACTS', () => {
    const ring = Object.entries(VERDICTS)
      .filter(([, v]) => v.state === 'unverified')
      .map(([k]) => k);
    expect(ring).toEqual(['challenged_ua', 'refused_unverified']);
    for (const k of ring) {
      expect(facts).toContain(`"${VERDICTS[k as Verdict].label}"`);
    }
  });

  it('marks which mappings are locked by FACTS and which are proposed', () => {
    const proposed = Object.entries(VERDICTS)
      .filter(([, v]) => !v.locked)
      .map(([k]) => k);
    expect(proposed).toEqual([
      'rate_limited',
      'payment_required',
      'edge_blocks_automation',
      'redirected_away',
      'not_measured',
    ]);
  });

  it('refuses a verdict or evidence class outside the vocabulary', () => {
    expect(() => html(<VerdictCell verdict={'blocked' as Verdict} evidence="declared" />)).toThrow(
      /verdict/,
    );
    expect(() =>
      html(<VerdictCell verdict="allowed" evidence={'guessed' as EvidenceClass} />),
    ).toThrow(/evidence/);
  });
});

describe('CoverageLine', () => {
  it('says how many pages were tested, of how many, across how many groups', () => {
    expect(textOf(html(<CoverageLine tested={50} total={214} groups={4} />))).toBe(
      'Tested 50 of 214 pages across 4 groups',
    );
  });

  it('uses the singular for one page and one group', () => {
    expect(coverageText({ tested: 1, total: 1, groups: 1 })).toBe(
      'Tested 1 of 1 page across 1 group',
    );
  });

  it('groups thousands', () => {
    expect(coverageText({ tested: 1284, total: 2000, groups: 12 })).toBe(
      'Tested 1,284 of 2,000 pages across 12 groups',
    );
  });

  it('refuses numbers that cannot be true', () => {
    expect(() => coverageText({ tested: 5, total: 4, groups: 1 })).toThrow();
    expect(() => coverageText({ tested: -1, total: 4, groups: 1 })).toThrow();
    expect(() => coverageText({ tested: 1.5, total: 4, groups: 1 })).toThrow();
    expect(() => coverageText({ tested: 3, total: 4, groups: 0 })).toThrow();
    expect(() => coverageText({ tested: 3, total: 4, groups: 4 })).toThrow();
  });

  it('property: renders the three numbers it was given and nothing else numeric', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 100_000 })
          .chain((total) =>
            fc
              .integer({ min: 1, max: total })
              .chain((tested) =>
                fc.integer({ min: 1, max: tested }).map((groups) => ({ tested, total, groups })),
              ),
          ),
        (input) => {
          const text = coverageText(input);
          const nums = [...text.matchAll(/[\d,]+/g)].map((m) => Number(m[0].replace(/,/g, '')));
          expect(nums).toEqual([input.tested, input.total, input.groups]);
          expect(text).toMatch(/^Tested [\d,]+ of [\d,]+ pages? across [\d,]+ groups?$/);
        },
      ),
    );
  });
});

describe('Card', () => {
  it('renders a raised surface by default and a sunken one on request', () => {
    expect(html(<Card>x</Card>)).toContain('data-v2-card="raised"');
    expect(html(<Card tone="sunken">x</Card>)).toContain('data-v2-card="sunken"');
  });

  it('renders as a link for a door, with a hover border and a focus ring', () => {
    expect(html(<Card href="/x">x</Card>)).toMatch(/^<a [^>]*href="\/x"/);
    expect(rule(css('Card'), '.link:hover')).toContain('border-color: var(--v2-fg)');
    expect(rule(css('Card'), '.link:focus-visible')).toContain('outline: 2px solid var(--v2-fg)');
  });

  it('uses the locked surface radius and a hairline, never a shadow (rules 2, 9)', () => {
    const r = rule(css('Card'), '.card');
    expect(r).toContain('border-radius: var(--v2-radius-surface)');
    expect(r).toContain('border: 1px solid var(--v2-line)');
    expect(css('Card')).not.toMatch(/box-shadow/);
  });
});

describe('Table', () => {
  const out = html(
    <Table
      label="What each crawler got back"
      columns={[{ header: 'Crawler' }, { header: 'Text it can read', numeric: true }]}
      rows={[
        { key: 'g', cells: ['Googlebot', '100%'] },
        { key: 'p', cells: ['Generic anchors', '+2 SEO'], muted: true },
      ]}
    />,
  );

  it('labels the table and scopes its headers', () => {
    expect(out).toContain('aria-label="What each crawler got back"');
    expect(out.match(/<th [^>]*scope="col"/g)).toHaveLength(2);
  });

  it('right-aligns numeric columns with tabular figures (rule 6)', () => {
    expect(out.match(/data-v2-numeric=""/g)).toHaveLength(3);
    expect(rule(css('Table'), '.num')).toContain('text-align: right');
    expect(rule(css('Table'), '.num')).toContain('font-variant-numeric: tabular-nums');
  });

  it('mutes a row', () => {
    expect(out).toContain('data-v2-muted=""');
  });

  it('wraps the table in a horizontal scroll region (tables of records scroll)', () => {
    expect(rule(css('Table'), '.scroll')).toContain('overflow-x: auto');
    // Screen-reader-only text is absolutely positioned; without a containing block here it takes
    // the viewport's, escapes the scroll clip, and widens the page at 390px (found by the harness).
    expect(rule(css('Table'), '.scroll')).toContain('position: relative');
    expect(rule(css('Table'), '.scroll:focus-visible')).toContain(
      'outline: 2px solid var(--v2-fg)',
    );
  });

  it('refuses a row whose cell count does not match the columns', () => {
    expect(() =>
      html(
        <Table label="t" columns={[{ header: 'a' }]} rows={[{ key: '1', cells: ['x', 'y'] }]} />,
      ),
    ).toThrow(/cells/);
  });
});

describe('Field', () => {
  it('ties its label to the input', () => {
    const out = html(<Field id="url" label="Website URL" type="url" />);
    expect(out).toMatch(/<label [^>]*for="url"[^>]*>Website URL<\/label>/);
    expect(out).toMatch(/<input [^>]*id="url"/);
  });

  it('hides the label visually but keeps it for screen readers', () => {
    expect(html(<Field id="u" label="Website URL" hideLabel />)).toContain('data-v2-sr-only');
  });

  it('sets data in the mono face and shows a focus ring', () => {
    expect(rule(css('Field'), '.input')).toContain('font-family: var(--v2-font-mono)');
    expect(rule(css('Field'), '.input:focus-visible')).toContain('outline: 2px solid var(--v2-fg)');
  });
});

describe('PageShell', () => {
  const out = html(
    <PageShell nav={[{ label: 'Pricing', href: '/pricing' }]}>
      <main>body</main>
    </PageShell>,
  );

  it('carries the brand mark unchanged: CrawlmouseMark, viewBox 0 0 48 44, peach body', () => {
    expect(out).toContain('viewBox="0 0 48 44"');
    expect(out).toContain('fill="#ff7849"');
    expect(out).toContain('stroke="#1a1a18"');
  });

  it('carries the wordmark: crawl + orange mouse', () => {
    expect(out).toMatch(/data-v2-wordmark="">crawl<span [^>]*>mouse<\/span>/);
    expect(rule(css('PageShell'), '.wordmarkMouse')).toContain('color: var(--v2-brand)');
  });

  it('recolours only the mark lines, through a token, so dark mode can keep them visible', () => {
    expect(css('PageShell')).toMatch(
      /\.mark line,\s*\.mark path \{\s*stroke: var\(--v2-mark-line\);/,
    );
  });

  it('names the home link with its visible text included (WCAG 2.5.3)', () => {
    expect(out).toMatch(/<a [^>]*aria-label="Crawlmouse home"/);
  });

  it('labels the primary navigation and renders the footer by default', () => {
    expect(out).toContain('aria-label="Primary"');
    expect(out).toContain('<footer');
    expect(html(<PageShell footer={false}>x</PageShell>)).not.toContain('<footer');
  });

  it('paints the page background and text from tokens', () => {
    const r = rule(css('PageShell'), '.shell');
    expect(r).toContain('background: var(--v2-bg)');
    expect(r).toContain('color: var(--v2-fg)');
    expect(r).toContain('font-family: var(--v2-font-body)');
  });
});
