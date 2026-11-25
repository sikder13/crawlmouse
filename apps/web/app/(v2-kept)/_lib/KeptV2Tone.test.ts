/**
 * F-265: the v2 tone for the kept blog, guides and author pages (`KeptV2Tone.module.css`).
 *
 * The sweep: it follows the imports of the five kept pages that carry the tone, collects each
 * colour or type utility class those files spell, and fails if the module has no rule for one. The
 * class list is read from the files, so a class added to a post or a component later fails here
 * until it is mapped. It also requires a rule for each `.article-prose` rule in `app/globals.css`
 * that sets a colour, since those rules colour the post body and carry no utility class.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WEB_ROOT,
  contrast,
  isColour,
  parseTokens,
  tokenMap,
} from '../../../__tests__/v2/_lib/tokens-css';

const MODULE = join(__dirname, 'KeptV2Tone.module.css');
const css = existsSync(MODULE) ? readFileSync(MODULE, 'utf8') : '';

/** The five kept pages that carry the tone. */
const ENTRIES = [
  'app/(v2-kept)/v2-kept/blog/page.tsx',
  'app/(v2-kept)/v2-kept/blog/[slug]/page.tsx',
  'app/(v2-kept)/v2-kept/blog/research/page.tsx',
  'app/(v2-kept)/v2-kept/guides/page.tsx',
  'app/(v2-kept)/v2-kept/authors/[slug]/page.tsx',
];

/**
 * Files the walk does not open, each with its reason. v1's header and footer are taken out of the
 * page by `withoutV1Chrome` before it renders; v2's components and copy style themselves through
 * their own modules and tokens; `opengraph-image` is an image route, not part of the page.
 */
const NOT_RENDERED = [
  /^components\/layout\/(Header|Footer)\.tsx$/,
  /^components\/v2\//,
  /^lib\/v2\//,
  /^styles\//,
  /opengraph-image\.tsx$/,
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB_ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = join(dirname(from), spec);
  else return null;
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = base + ext;
    if (existsSync(p) && /\.tsx?$/.test(p)) return p;
  }
  return null;
}

/** The entries and every local module they reach, by import or re-export. */
function renderSet(): string[] {
  const seen = new Set<string>();
  const queue = ENTRIES.map((e) => join(WEB_ROOT, e));
  while (queue.length) {
    const file = queue.pop()!;
    const rel = relative(WEB_ROOT, file);
    if (seen.has(file) || NOT_RENDERED.some((r) => r.test(rel))) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) {
      const next = resolveImport(file, m[1]!);
      if (next) queue.push(next);
    }
  }
  return [...seen].map((f) => relative(WEB_ROOT, f)).sort();
}

const V1_COLOURS =
  'cream|oat|ink(?:-muted)?|peach(?:-light|-text)?|sage(?:-light|-fill)?|warning(?:-fill)?|' +
  'surface(?:-raised)?|accent(?:-text|-fill)?|positive|locked|white|black|transparent|current|' +
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|' +
  'indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}|\\[[^\\]]+\\]';
const COLOUR_UTILITY = new RegExp(
  `^(?:[a-z-]+:)*(?:text|bg|border(?:-[trblxy])?|ring|ring-offset|divide|outline|decoration|` +
    `fill|stroke|from|via|to|placeholder|caret|accent|shadow)-(?:${V1_COLOURS})(?:\\/\\d+)?$`,
);
const TYPE_UTILITY = /^(?:[a-z-]+:)*font-(?:display|sans|serif|mono)$/;

/** Each colour or type utility spelled in a string literal of `file`. */
function classesIn(file: string): string[] {
  const src = readFileSync(join(WEB_ROOT, file), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const token of text.split(/\s+/)) {
      if (COLOUR_UTILITY.test(token) || TYPE_UTILITY.test(token)) out.add(token);
    }
  }
  return [...out];
}

/** Tailwind's class name as a CSS selector spells it: `hover:text-ink/70` → `hover\:text-ink\/70`. */
const escapeClass = (c: string) => c.replace(/([:/[\]#.])/g, '\\$1');

/** The module's rules: selector list and body, with comments removed. */
function rules(source: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      selectors: m[1]!
        .split(',')
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
      body: m[2]!,
    });
  }
  return out;
}

const VARIANT_STATE: Record<string, string> = {
  hover: ':hover',
  'focus-visible': ':focus-visible',
  'group-hover': ':global(.group):hover',
};

/** The selector a class's rule must carry under the tone, as a descendant of the content wrapper. */
function wantedSelector(cls: string): string {
  const parts = cls.split(':');
  parts.pop();
  const variants = parts;
  const escaped = `:global(.${escapeClass(cls)})`;
  if (variants.length === 0) return `.tone ${escaped}`;
  if (variants.length > 1) throw new Error(`${cls}: more than one variant; add it to the sweep`);
  const v = variants[0]!;
  const state = VARIANT_STATE[v];
  if (!state) throw new Error(`${cls}: no state known for variant ${v}; add it to the sweep`);
  if (v === 'group-hover') return `.tone ${state} ${escaped}`;
  return `.tone ${escaped}${state}`;
}

/** A text class on the filled call to action is mapped with it: `.bg-peach.text-white`. */
const ON_ACCENT = ['text-white', 'text-cream'];
const onAccent = (cls: string) =>
  ON_ACCENT.includes(cls) ? `.tone :global(.bg-peach.${cls})` : '';

const moduleRules = rules(css);
const ruleFor = (selector: string) =>
  moduleRules.find((r) => r.selectors.includes(selector) && /var\(--v2-[\w-]+\)/.test(r.body));

describe('the v2 tone sweep', () => {
  const files = renderSet();
  const byClass = new Map<string, string[]>();
  for (const f of files) {
    for (const c of classesIn(f)) byClass.set(c, [...(byClass.get(c) ?? []), f]);
  }

  it('walks the files the five pages render: the pages, their layouts, the posts and Card', () => {
    for (const f of [
      'app/blog/page.tsx',
      'app/blog/[slug]/page.tsx',
      'app/blog/research/page.tsx',
      'app/guides/page.tsx',
      'app/authors/[slug]/page.tsx',
      'components/blog/ArticleLayout.tsx',
      'components/blog/ClusterLinks.tsx',
      'components/ui/Card.tsx',
      'lib/blog/post-card.tsx',
      'lib/blog/content/orphan-pages.tsx',
      'lib/blog/content/sitebulb-alternative.tsx',
      'app/(v2-kept)/_lib/KeptShell.tsx',
    ]) {
      expect(files, f).toContain(f);
    }
    expect(files.filter((f) => f.startsWith('lib/blog/content/')).length).toBeGreaterThan(15);
    expect(files).not.toContain('components/layout/Header.tsx');
  });

  it('finds the classes it is meant to find (the collector is live)', () => {
    for (const c of ['text-ink', 'text-ink/70', 'bg-white', 'border-oat', 'font-display']) {
      expect([...byClass.keys()], c).toContain(c);
    }
    expect(byClass.size).toBeGreaterThan(15);
  });

  it('has a rule, setting a v2 token, for every colour and type class those files use', () => {
    const missing = [...byClass.keys()]
      .sort()
      .filter((c) => !ruleFor(wantedSelector(c)) && !ruleFor(onAccent(c)))
      .map((c) => `${c} (${byClass.get(c)!.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('spells the on-accent text classes only beside bg-peach, so mapping them with it covers each', () => {
    const alone: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(WEB_ROOT, f), 'utf8');
      for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
        const tokens = (m[1] ?? m[2] ?? m[3] ?? '').split(/\s+/);
        if (ON_ACCENT.some((c) => tokens.includes(c)) && !tokens.includes('bg-peach'))
          alone.push(`${f}: ${m[0]}`);
      }
    }
    expect(alone).toEqual([]);
  });

  it("colours the content wrapper itself, whose classes are the wrapper's own", () => {
    for (const c of ['bg-cream', 'text-ink', 'font-sans']) {
      expect(ruleFor(`.tone:global(.${c})`), c).toBeDefined();
    }
  });

  it('has a rule for every .article-prose rule in globals.css that sets a colour', () => {
    const globals = readFileSync(join(WEB_ROOT, 'app', 'globals.css'), 'utf8');
    const coloured = rules(globals)
      .filter((r) => r.selectors.every((s) => s.startsWith('.article-prose')))
      .filter((r) => /(^|[\s;])(color|background|border[\w-]*)\s*:|@apply\s+text-/.test(r.body));
    expect(coloured.length).toBeGreaterThan(5);
    const missing = coloured
      .flatMap((r) => r.selectors)
      .filter((s) => {
        const [head, ...rest] = s.split(' ');
        const scoped = `.tone :global(${head})${rest.length ? ` ${rest.join(' ')}` : ''}`;
        return !ruleFor(scoped);
      });
    expect(missing).toEqual([]);
  });

  it('names only v2 tokens that exist', () => {
    const defined = new Set(parseTokens().map((d) => d.name));
    const used = [...css.matchAll(/var\((--v2-[\w-]+)\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((n) => !defined.has(n))).toEqual([]);
  });
});

/**
 * The text-on-surface pairs the mapping creates, by token. Each is a pair `tokens.test.ts` already
 * proves; they are checked again here so this file fails on its own if a mapping moves a text
 * class onto a pair that does not clear 4.5:1.
 */
const TEXT_PAIRS: [text: string, surface: string, where: string][] = [
  ['fg', 'bg', 'text-ink, hover text, .article-prose strong and links on the canvas'],
  ['fg', 's1', 'text-ink and links on a bg-white card'],
  ['fg', 's2', 'text-ink on bg-peach/5 and inline code'],
  ['fg2', 'bg', 'text-ink/70 and /80, .article-prose body text on the canvas'],
  ['fg2', 's1', 'text-ink/70 and /80 on a bg-white card'],
  ['fg2', 's2', 'text-ink/70 and /80 on bg-peach/5'],
  ['mut', 'bg', 'text-ink/50 and /60 on the canvas'],
  ['mut', 's1', 'text-ink/50 and /60 on a bg-white card'],
  ['mut', 's2', 'text-ink/50 and /60 on bg-peach/5'],
  ['on-acc', 'acc', 'text-white and text-cream on bg-peach'],
  ['on-acc', 'acc2', 'text-white on hover:bg-peach/90'],
];

describe('the v2 tone: contrast of each text pair it creates', () => {
  const decls = parseTokens();
  const root = tokenMap(decls, 'root');
  const themes = [
    ['light', root],
    ['dark', new Map([...root, ...tokenMap(decls, 'dark-media')])],
  ] as const;
  for (const [theme, t] of themes) {
    const v = (n: string) => {
      const value = t.get(`--v2-${n}`)?.value;
      if (!value || !isColour(value)) throw new Error(`--v2-${n} is not a colour in ${theme}`);
      return value;
    };
    for (const [a, b, where] of TEXT_PAIRS) {
      it(`${theme}: ${a} on ${b} clears 4.5:1 (${where})`, () => {
        expect(contrast(v(a), v(b))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
