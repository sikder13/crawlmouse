import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import fc from 'fast-check';
import { scoreToLetter } from '../../../../packages/engine/src/grade';
import {
  Button,
  Card,
  CoverageLine,
  coverageText,
  EVIDENCE_CLASSES,
  Field,
  GRADE_LETTERS,
  Grade,
  glyphShape,
  PILL_STATES,
  type GlyphChar,
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
/**
 * The declarations of every rule in a CSS module whose selector is exactly `selector`, in order and
 * whitespace-collapsed, so a later rule that overrides an earlier one is part of what is checked.
 */
const rule = (src: string, selector: string) => {
  const bodies: string[] = [];
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[1] ?? '').trim().replace(/\s+/g, ' ') === selector) {
      bodies.push((m[2] ?? '').replace(/\s+/g, ' ').trim());
    }
  }
  return bodies.length ? bodies.join(' ') : null;
};
/** The last value a selector's rules give a property: what the cascade lands on. */
const last = (src: string, selector: string, prop: string) => {
  const r = rule(src, selector) ?? '';
  const all = [...r.matchAll(new RegExp(`(?:^|;\\s*)${prop}:\\s*([^;]+)`, 'g'))];
  return all.at(-1)?.[1]?.trim() ?? null;
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

  it('shows a keyboard focus ring, and nothing later in the file hides it', () => {
    expect(last(css('Button'), '.btn:focus-visible', 'outline')).toBe('2px solid var(--v2-fg)');
    expect(rule(css('Button'), '.btn:focus-visible')).not.toMatch(
      /outline(-color)?: (none|transparent)/,
    );
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

  it('shows no typed glyph character in its text, so no font fallback can change it', () => {
    for (const state of [...glyphStates, 'neutral'] as PillState[]) {
      expect(textOf(html(<StatusPill state={state}>x</StatusPill>))).not.toMatch(/[●▲■○]/);
    }
  });

  // Pinned against the facts file's glyph line, not against the component's own table.
  it('gives each state the glyph FACTS-proposed.md assigns it (rule 7)', () => {
    const facts = readFileSync(
      join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'FACTS-proposed.md'),
      'utf8',
    );
    const line = facts.split('\n').find((l) => l.startsWith('Glyphs:')) ?? '';
    const words = (glyph: string) => line.split(glyph)[1]?.split('·')[0] ?? '';
    expect(words('●')).toMatch(/\bok\b/);
    expect(words('▲')).toMatch(/\bwarn\b/);
    expect(words('■')).toMatch(/\bbad\b/);
    expect(words('○')).toMatch(/\bunverified\b/);
    expect(PILL_STATES.ok.glyph).toBe('●');
    expect(PILL_STATES.warn.glyph).toBe('▲');
    expect(PILL_STATES.bad.glyph).toBe('■');
    expect(PILL_STATES.unverified.glyph).toBe('○');
    expect(PILL_STATES.neutral.glyph).toBeNull();
  });

  it('draws the shape its glyph names: filled circle, triangle, square, ring', () => {
    const shape = (g: GlyphChar) => renderToStaticMarkup(<svg>{glyphShape(g)}</svg>);
    expect(shape('●')).toMatch(/<circle [^>]*fill="currentColor"/);
    expect(shape('▲')).toMatch(/<polygon points="(\S+,\S+ ){2}\S+,\S+" fill="currentColor"/);
    expect(shape('■')).toMatch(/<rect [^>]*fill="currentColor"/);
    expect(shape('○')).toMatch(/<circle [^>]*fill="none"[^>]*stroke="currentColor"/);
    for (const state of glyphStates) {
      const g = PILL_STATES[state].glyph as GlyphChar;
      const out = html(<StatusPill state={state}>x</StatusPill>);
      expect(out, state).toContain(`data-v2-glyph-char="${g}"`);
      expect(out, state).toContain(shape(g).replace(/^<svg>|<\/svg>$/g, ''));
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

  it('accepts exactly the letters the engine can return', () => {
    const fromEngine = new Set(Array.from({ length: 101 }, (_, n) => scoreToLetter(n)));
    expect([...GRADE_LETTERS].sort()).toEqual([...fromEngine].sort());
    for (const letter of ['E', 'A+', 'F+', 'F-', 'b']) {
      expect(() => html(<Grade label="x" letter={letter} score={50} />), letter).toThrow(/letter/);
    }
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

  it('marks a glyph proposed wherever FACTS leaves it to a later design item', () => {
    const proposed = Object.entries(VERDICTS)
      .filter(([, v]) => !v.glyphFromFacts)
      .map(([k]) => k);
    expect(proposed).toEqual([
      'rate_limited',
      'payment_required',
      'edge_blocks_automation',
      'redirected_away',
      'not_measured',
    ]);
    // FACTS names these four as needing glyph and copy in the new-states design item.
    const later =
      facts
        .split('\n')
        .find((l) => l.includes('need glyph and copy in the new-states design item')) ?? '';
    const named = [...later.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '');
    for (const k of ['rate_limited', 'payment_required', 'redirected_away', 'not_measured']) {
      expect(named, k).toContain(k);
      expect(VERDICTS[k as Verdict].glyphFromFacts, k).toBe(false);
    }
  });

  it('marks only the challenged wording as set by FACTS; the other labels are proposed', () => {
    const fromFacts = Object.entries(VERDICTS)
      .filter(([, v]) => v.labelFromFacts)
      .map(([k]) => k);
    expect(fromFacts).toEqual(['challenged_ua', 'refused_unverified']);
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

  it('uses the singular for one page and one group, each keyed on its own count', () => {
    expect(coverageText({ tested: 1, total: 1, groups: 1 })).toBe(
      'Tested 1 of 1 page across 1 group',
    );
    expect(coverageText({ tested: 1, total: 5, groups: 1 })).toBe(
      'Tested 1 of 5 pages across 1 group',
    );
    expect(coverageText({ tested: 3, total: 3, groups: 1 })).toBe(
      'Tested 3 of 3 pages across 1 group',
    );
    expect(coverageText({ tested: 2, total: 9, groups: 2 })).toBe(
      'Tested 2 of 9 pages across 2 groups',
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
          expect(/ page across /.test(text)).toBe(input.total === 1);
          expect(/ group$/.test(text)).toBe(input.groups === 1);
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
    expect(rule(css('Table'), '.table .num')).toContain('text-align: right');
    expect(rule(css('Table'), '.table .num')).toContain('font-variant-numeric: tabular-nums');
    // Numbers may wrap like any cell: a no-wrap rule here made the Result fixes table overflow
    // its card at 390 px. "+24 AI" fits at 1280 because mono cells are 13px (tested below).
    expect(rule(css('Table'), '.table .num')).not.toContain('white-space: nowrap');
  });

  it('sets mono cells in the 13px data face, above the 15px cell size (as .m beats td)', () => {
    expect(rule(css('Table'), '.mono')).toBeNull();
    expect(last(css('Table'), '.table .mono', 'font-size')).toBe('var(--v2-text-micro)');
    expect(last(css('Table'), '.table td, .table th', 'font-size')).toBe('var(--v2-text-ui)');
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

  it('hides the label visually but keeps it for screen readers, taking no room in a row', () => {
    const out = html(<Field id="u" label="Website URL" hideLabel />);
    // The label element itself is the hidden one, so no zero-width flex item is left behind.
    expect(out).toMatch(/^<label [^>]*for="u"[^>]*data-v2-sr-only=""[^>]*>Website URL<\/label>/);
    expect(last(css('layout'), '.srOnly', 'position')).toBe('absolute');
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

  it('sets bold text at 600, never 700 (rule 5; the locked pages loaded no heavier weight)', () => {
    // 0,1,1 beats Tailwind preflight's `b, strong { font-weight: bolder }` (0,0,1).
    expect(last(css('PageShell'), '.shell strong, .shell b', 'font-weight')).toBe('600');
    const modules = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name.endsWith('.module.css')
            ? [join(dir, e.name)]
            : [],
      );
    })(join(WEB_ROOT, 'components', 'v2'));
    expect(modules.length).toBeGreaterThan(10);
    const sevenHundred = modules
      .filter((f) =>
        /font-weight:\s*(700|bold|bolder|[89]00)\s*[;}]/.test(
          readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
        ),
      )
      .map((f) => f.slice(WEB_ROOT.length + 1));
    expect(sevenHundred).toEqual([]);
  });

  it('underlines a plain link on hover, above preflight and below a button or door', () => {
    expect(last(css('PageShell'), ':where(.shell) a:hover', 'text-decoration')).toBe('underline');
    expect(last(css('Button'), '.btn:hover', 'text-decoration')).toBe('none');
    expect(last(css('Card'), '.link:hover', 'text-decoration')).toBe('none');
  });

  it('paints the page background and text from tokens', () => {
    const r = rule(css('PageShell'), '.shell');
    expect(r).toContain('background: var(--v2-bg)');
    expect(r).toContain('color: var(--v2-fg)');
    expect(r).toContain('font-family: var(--v2-font-body)');
  });
});
