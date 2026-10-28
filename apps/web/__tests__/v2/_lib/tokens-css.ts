import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WEB_ROOT = join(__dirname, '..', '..', '..');
export const TOKENS_PATH = join(WEB_ROOT, 'styles', 'v2', 'tokens.css');

/** Which block of tokens.css a declaration sits in. */
export type TokenBlock = 'root' | 'dark-media' | 'dark-attr';

export interface TokenDecl {
  name: string;
  value: string;
  /** The trailing comment on the declaration line, e.g. `base: --bg` or `brand: peach`. */
  source: string | null;
  block: TokenBlock;
}

/**
 * Parse the custom-property declarations of tokens.css, recording the selector chain each one
 * sits under. It walks braces and semicolons, not lines, so a declaration the formatter wraps
 * over two lines is still one declaration. A comment is a declaration's source only when it
 * starts on the same line as that declaration's semicolon.
 */
export function parseTokens(css: string = readFileSync(TOKENS_PATH, 'utf8')): TokenDecl[] {
  const out: TokenDecl[] = [];
  const stack: string[] = [];
  let buf = '';
  // The declaration just closed by `;`, until a newline or another token intervenes.
  let open: TokenDecl | null = null;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment in tokens.css');
      if (open) open.source = css.slice(i + 2, end).trim();
      open = null;
      i = end + 1;
      continue;
    }
    const ch = css.charAt(i);
    if (ch === '\n') open = null;
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
      open = null;
    } else if (ch === '}') {
      stack.pop();
      buf = '';
      open = null;
    } else if (ch === ';') {
      const m = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(buf.trim());
      buf = '';
      open = null;
      if (m?.[1] && m[2]) {
        const decl: TokenDecl = {
          name: m[1],
          value: m[2].replace(/\s+/g, ' ').trim(),
          source: null,
          block: blockOf(stack),
        };
        out.push(decl);
        open = decl;
      }
    } else if (!/\s/.test(ch) || buf) {
      buf += ch;
    }
  }
  return out;
}

function blockOf(stack: string[]): TokenBlock {
  const chain = stack.join(' > ').replace(/\s+/g, ' ');
  if (chain === ':root') return 'root';
  if (
    /^@media \(prefers-color-scheme: dark\) > :root:not\(\[data-theme=(['"])light\1\]\)$/.test(
      chain,
    )
  ) {
    return 'dark-media';
  }
  if (/^:root\[data-theme=(['"])dark\1\]$/.test(chain)) return 'dark-attr';
  throw new Error(`tokens.css declares a token under an unexpected selector: ${chain}`);
}

export const tokenMap = (decls: TokenDecl[], block: TokenBlock): Map<string, TokenDecl> =>
  new Map(decls.filter((d) => d.block === block).map((d) => [d.name, d]));

export const isColour = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

// ── WCAG 2.x contrast ────────────────────────────────────────────────────────────────────────
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The `:root{...}` custom properties of one locked screen, the independent source of truth. */
export function lockedRoot(screen: string): Map<string, string> {
  const html = readFileSync(
    join(WEB_ROOT, '..', '..', 'docs', 'design', 'v2', 'screens', screen),
    'utf8',
  );
  const m = /:root\{([^}]*)\}/.exec(html);
  if (!m?.[1]) throw new Error(`no :root block in ${screen}`);
  return new Map(
    m[1]
      .split(';')
      .filter(Boolean)
      .map((d) => {
        const [k = '', v = ''] = d.split(':');
        return [k.trim(), v.trim()] as [string, string];
      }),
  );
}
