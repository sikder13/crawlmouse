import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BRAND } from '../../lib/brand';
import {
  WEB_ROOT,
  contrast,
  isColour,
  lockedRoot,
  parseTokens,
  tokenMap,
  type TokenDecl,
} from './_lib/tokens-css';
import { baseCssValue } from './_lib/base-css';

const DESIGN = join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2');

/** Compare CSS values the way a browser reads them: case, whitespace and leading zeros ignored. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[^0-9])0\./g, '$1.');

const decls = parseTokens();
const root = tokenMap(decls, 'root');
const darkMedia = tokenMap(decls, 'dark-media');
const darkAttr = tokenMap(decls, 'dark-attr');

function files(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(css|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `var(--name` reference in a file, with its line for the failure message. */
function varRefs(path: string): { name: string; where: string }[] {
  const src = readFileSync(path, 'utf8');
  const refs: { name: string; where: string }[] = [];
  src.split('\n').forEach((line, n) => {
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      refs.push({ name: m[1] ?? '', where: `${relative(WEB_ROOT, path)}:${n + 1}` });
    }
  });
  return refs;
}

describe('v2 tokens: structure', () => {
  it('parses a non-trivial token set from every block', () => {
    expect(root.size).toBeGreaterThan(40);
    expect(darkMedia.size).toBeGreaterThan(20);
    expect(darkAttr.size).toBeGreaterThan(20);
  });

  it('declares each token once per block', () => {
    for (const block of ['root', 'dark-media', 'dark-attr'] as const) {
      const names = decls.filter((d) => d.block === block).map((d) => d.name);
      expect(
        names.filter((n, i) => names.indexOf(n) !== i),
        block,
      ).toEqual([]);
    }
  });

  it('namespaces every token as --v2-*', () => {
    expect(decls.map((d) => d.name).filter((n) => !n.startsWith('--v2-'))).toEqual([]);
  });

  it('gives every token a default in :root (dark blocks only override)', () => {
    const orphans = [...darkMedia.keys(), ...darkAttr.keys()].filter((n) => !root.has(n));
    expect(orphans).toEqual([]);
  });

  it('defines every colour token for dark as well as light', () => {
    const colours = [...root.values()].filter((d) => isColour(d.value)).map((d) => d.name);
    expect(colours.length).toBeGreaterThan(30);
    expect(colours.filter((n) => !darkMedia.has(n))).toEqual([]);
    expect(colours.filter((n) => !darkAttr.has(n))).toEqual([]);
  });

  it('keeps the system-dark block and the explicit data-theme="dark" block identical', () => {
    const flat = (m: Map<string, TokenDecl>) =>
      [...m.values()].map((d) => `${d.name}=${d.value}`).sort();
    expect(flat(darkMedia)).toEqual(flat(darkAttr));
  });

  it('records where every token value came from', () => {
    const missing = decls.filter((d) => !d.source).map((d) => `${d.name} (${d.block})`);
    expect(missing).toEqual([]);
    const badKind = decls
      .filter((d) => d.source && !/^(base|base\.css|brand|screen|derived|font):/.test(d.source))
      .map((d) => `${d.name} /* ${d.source} */`);
    expect(badKind).toEqual([]);
  });
});

describe('v2 tokens: every variable used is defined', () => {
  const scanned = [
    ...files(join(WEB_ROOT, 'components', 'v2')),
    ...files(join(WEB_ROOT, 'app', '(v2-preview)')),
  ];

  it('finds the v2 source files to scan', () => {
    expect(scanned.length).toBeGreaterThan(10);
  });

  it('references only tokens that tokens.css defines in :root', () => {
    const undefinedRefs = scanned
      .flatMap(varRefs)
      .filter((r) => !root.has(r.name))
      .map((r) => `${r.name} at ${r.where}`);
    expect(undefinedRefs).toEqual([]);
  });

  it('references only tokens that are defined, inside tokens.css itself', () => {
    const own = varRefs(join(WEB_ROOT, 'styles', 'v2', 'tokens.css'))
      .filter((r) => r.name.startsWith('--v2-') && !root.has(r.name))
      .map((r) => `${r.name} at ${r.where}`);
    expect(own).toEqual([]);
  });
});

describe('v2 tokens: values match their stated source', () => {
  const light = lockedRoot('Final-Home.dc.html');
  const lightResult = lockedRoot('Final-Result.dc.html');
  const dark = lockedRoot('Final-Result-Dark.dc.html');

  it('reads the locked light :root identically from both light screens', () => {
    expect([...light.entries()]).toEqual([...lightResult.entries()]);
  });

  it('copies every base-sourced value verbatim from the locked screens, light and dark', () => {
    const wrong: string[] = [];
    for (const d of decls) {
      const m = /^base: (--[\w-]+)$/.exec(d.source ?? '');
      if (!m?.[1]) continue;
      const want = (d.block === 'root' ? light : dark).get(m[1]);
      if (want === undefined) wrong.push(`${d.name}: ${m[1]} is not in the locked :root`);
      else if (d.value.toLowerCase() !== want.toLowerCase()) {
        wrong.push(`${d.name} (${d.block}) = ${d.value}, locked ${m[1]} = ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('equals the base.css declaration each base.css source names, exactly', () => {
    const cited = decls.filter((d) => d.source?.startsWith('base.css:'));
    expect(cited.length).toBeGreaterThan(30);
    const wrong = cited
      .map((d) => {
        const ref = d.source!.slice('base.css:'.length).trim();
        let want: string;
        try {
          want = baseCssValue(ref);
        } catch (e) {
          return `${d.name}: ${(e as Error).message}`;
        }
        return norm(want) === norm(d.value)
          ? null
          : `${d.name} = ${d.value}, base.css ${ref} = ${want}`;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);
  });

  it('resolves base.css references exactly, not by substring', () => {
    expect(baseCssValue('.m font-size')).toBe('13px');
    expect(baseCssValue('td,th padding[1]')).toBe('16px');
    expect(baseCssValue('.late animation[2]')).toBe('2.8s');
    expect(baseCssValue('@media (max-width:760px) .h-xl font-size')).toBe('34px');
    expect(baseCssValue('.h-xl font-size')).toBe('56px');
    expect(() => baseCssValue('.nope font-size')).toThrow();
  });

  it('finds every screen-sourced value in the attribute or property its source names', () => {
    const cited = decls.filter((d) => d.source?.startsWith('screen:'));
    expect(cited.length).toBeGreaterThan(5);
    const wrong = cited
      .map((d) => {
        const [file, attr] = d.source!.slice('screen:'.length).trim().split(/\s+/);
        if (!file || !attr) return `${d.name}: source must name a file and an attribute`;
        const html = norm(readFileSync(join(DESIGN, 'screens', file), 'utf8'));
        const v = norm(d.value);
        return html.includes(`${attr}="${v}"`) || html.includes(`${attr}:${v}`)
          ? null
          : `${d.name} = ${d.value} is not a ${attr} in ${file}`;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);
  });

  it('starts every font-sourced value with the variable lib/fonts.ts declares for that family', () => {
    const fontsTs = readFileSync(join(WEB_ROOT, 'lib', 'fonts.ts'), 'utf8');
    const variableOf = (family: string) => {
      const ctor = family.replace(/ /g, '_');
      const m = new RegExp(`= ${ctor}\\(\\{[\\s\\S]*?variable: '([^']+)'`).exec(fontsTs);
      return m?.[1];
    };
    const cited = decls.filter((d) => d.source?.startsWith('font:'));
    expect(cited.map((d) => d.source)).toEqual([
      'font: Fraunces',
      'font: Geist',
      'font: Geist Mono',
    ]);
    for (const d of cited) {
      const v = variableOf(d.source!.slice('font:'.length).trim());
      expect(v, d.name).toMatch(/^--font-/);
      expect(d.value.startsWith(`var(${v})`), `${d.name} = ${d.value}`).toBe(true);
    }
  });

  it('copies every brand-sourced value verbatim from lib/brand.ts', () => {
    const brandDecls = decls.filter((d) => d.source?.startsWith('brand:'));
    expect(brandDecls.length).toBeGreaterThan(0);
    const wrong = brandDecls
      .map((d) => {
        const key = d.source!.slice('brand:'.length).trim() as keyof typeof BRAND;
        const want = BRAND[key];
        return want && want.toLowerCase() === d.value.toLowerCase()
          ? null
          : `${d.name} = ${d.value}, BRAND.${key} = ${want}`;
      })
      .filter(Boolean);
    expect(wrong).toEqual([]);
  });

  it('takes the accent from the brand, not from the locked #F2541B', () => {
    expect(root.get('--v2-acc')?.source).toBe('brand: peach');
    expect(root.get('--v2-acc')?.value.toLowerCase()).toBe(BRAND.peach);
  });

  it('routes the brand fonts through the next/font variables from lib/fonts.ts', () => {
    expect(root.get('--v2-font-display')?.value).toMatch(/^var\(--font-fraunces\)/);
    expect(root.get('--v2-font-body')?.value).toMatch(/^var\(--font-geist\)/);
    expect(root.get('--v2-font-mono')?.value).toMatch(/^var\(--font-geist-mono\)/);
    const plex = decls.filter((d) => /plex/i.test(d.value)).map((d) => d.name);
    expect(plex).toEqual([]);
  });

  it('keeps the locked radii: controls 5px, surfaces 8px (rule 9)', () => {
    expect(root.get('--v2-radius-control')?.value).toBe('5px');
    expect(root.get('--v2-radius-surface')?.value).toBe('8px');
  });
});

describe('v2 tokens: contrast', () => {
  it('computes contrast against independently known values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    // #767676 on white is the well-known smallest grey that clears 4.5:1 (4.54).
    expect(contrast('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.5);
  });

  const themes = [
    ['light', root],
    ['dark', new Map([...root, ...darkMedia])],
  ] as const;

  for (const [theme, t] of themes) {
    const v = (n: string) => {
      const value = t.get(`--v2-${n}`)?.value;
      if (!value || !isColour(value)) throw new Error(`--v2-${n} is not a colour in ${theme}`);
      return value;
    };
    const text: [string, string, number][] = [];
    for (const fg of ['fg', 'fg2', 'mut']) {
      for (const bg of ['bg', 's1', 's2']) text.push([fg, bg, 4.5]);
    }
    text.push(
      ['ok', 'okbg', 4.5],
      ['bad', 'badbg', 4.5],
      ['warn', 'warnbg', 4.5],
      ['neu', 'neubg', 4.5],
      ['on-acc', 'acc', 4.5],
      ['on-acc', 'acc2', 4.5],
      ['barfg', 'barbg', 4.5],
      ['barmut', 'barbg', 4.5],
      ['bad', 's1', 4.5],
      ['ctl', 'bg', 3],
      ['ctl', 's1', 3],
      ['ctl', 's2', 3],
    );
    for (const [a, b, min] of text) {
      it(`${theme}: ${a} on ${b} clears ${min}:1`, () => {
        expect(contrast(v(a), v(b))).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
