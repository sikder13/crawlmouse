import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_ROOT } from './tokens-css';

const BASE = join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'base.css');

/**
 * The declarations of docs/design/v2/base.css, keyed by rule: the selector as written, prefixed
 * by its @media prelude when it sits in one ("@media (max-width:760px) .wrap"). A later
 * declaration of the same property under the same key replaces an earlier one, as the cascade does.
 */
function parseBase(css: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  const stack: string[] = [];
  let buf = '';
  for (const ch of css.replace(/\{\{ROOT\}\}/g, '')) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}') {
      const decls = buf;
      const selector = stack.pop() ?? '';
      if (!selector.startsWith('@') && decls.trim()) {
        const key = [...stack.filter((s) => s.startsWith('@media')), selector].join(' ');
        const map = rules.get(key) ?? new Map<string, string>();
        for (const d of decls.split(';')) {
          const at = d.indexOf(':');
          if (at > 0) map.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
        }
        rules.set(key, map);
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** Split a CSS value into its space-separated parts, keeping a function call whole. */
function parts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const RULES = parseBase(readFileSync(BASE, 'utf8'));

/**
 * The value base.css gives for a reference such as ".btn min-height", "td,th padding[1]" or
 * "@media (max-width:760px) .h-xl font-size": the selector, then the property, then an optional
 * index into the value's parts. Throws when base.css has no such declaration.
 */
export function baseCssValue(ref: string): string {
  const m = /^(.*\S)\s+([a-z-]+)(?:\[(\d+)\])?$/.exec(ref.trim());
  if (!m?.[1] || !m[2]) throw new Error(`not a base.css reference: ${ref}`);
  const rule = RULES.get(m[1]);
  const raw = rule?.get(m[2]);
  if (raw === undefined) throw new Error(`base.css has no ${m[2]} under "${m[1]}"`);
  const value = raw.replace(/\s*!important\s*$/, '');
  if (m[3] === undefined) return value;
  const part = parts(value)[Number(m[3])];
  if (part === undefined) throw new Error(`${ref}: "${value}" has no part ${m[3]}`);
  return part;
}
