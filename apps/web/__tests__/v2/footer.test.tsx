// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FOOTER_COLUMNS,
  FOOTER_COPY,
  LOG_IN,
  MARKETING_NAV,
  SUPPORT_EMAIL,
  isGroup,
  type FooterItem,
  type SiteLink,
} from '../../components/v2/footer-links';
import { SiteFooter, type ServiceStatus } from '../../components/v2/SiteFooter';
import { CopyEmail } from '../../components/v2/CopyEmail';
import { CookieSettings } from '../../components/v2/CookieSettings';
import { PageShell } from '../../components/v2/PageShell';
import { CONSENT_OPEN_EVENT } from '../../lib/consent';
import { allPostSlugs } from '../../lib/blog/posts';

// Under jsdom, import.meta.url is not a file URL, so _lib/tokens-css's WEB_ROOT cannot be used here.
const WEB_ROOT = join(__dirname, '..', '..');

// The sitemap reads the claimed /r/ reports from the database; stubbed empty, as
// seo-robots-sitemap-guard.test.ts does, so only the static set is listed.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = join(WEB_ROOT, 'app');

/**
 * Whether the live app serves a page at this path: a page.tsx under apps/web/app, reached through
 * literal folders, or through blog/[slug] for a slug the blog lists. Route groups are not entered,
 * so the preview pages under (v2-preview) do not count as live.
 */
function served(href: string): boolean {
  if (!href.startsWith('/') || /[?#]/.test(href)) return false;
  const segments = href.split('/').filter(Boolean);
  if (segments[0] === 'blog' && segments.length === 2) {
    return (
      existsSync(join(APP, 'blog', '[slug]', 'page.tsx')) && allPostSlugs().includes(segments[1]!)
    );
  }
  return existsSync(join(APP, ...segments, 'page.tsx'));
}

const liveLinks = (items: readonly (FooterItem | SiteLink)[]) =>
  items.filter((i): i is SiteLink & { href: string } => 'href' in i && typeof i.href === 'string');

const footerItems = FOOTER_COLUMNS.flatMap((c) => c.items);
const navLinks = MARKETING_NAV.flatMap((e) => (isGroup(e) ? e.items : [e]));

describe('footer-links.ts: the one map of header and footer links', () => {
  it('has the four columns the step asked for, in order', () => {
    expect(FOOTER_COLUMNS.map((c) => c.title)).toEqual([
      'Product',
      'Learn',
      'Free checks',
      'Company and legal',
    ]);
  });

  // The approved plan's table, written out as independent truth: a change to a label or a target
  // has to change this table too.
  it('points each footer entry at the approved target', () => {
    const target = (i: FooterItem) =>
      'control' in i ? `control:${i.control}` : i.planned ? 'planned' : i.href;
    expect(FOOTER_COLUMNS.map((c) => [c.title, c.items.map((i) => [i.label, target(i)])])).toEqual([
      [
        'Product',
        [
          ['Free audit', '/'],
          ['Pricing', '/pricing'],
          ['For agencies', 'planned'],
          ['Developers', '/developers'],
          ['Changelog', 'planned'],
          ['Status', '/status'],
        ],
      ],
      [
        'Learn',
        [
          ['Blog', '/blog'],
          ['Research', '/blog'],
          ['Guides', '/guides'],
          ['Docs', 'planned'],
          ['How the grade works', 'planned'],
          ['Our crawler', '/bot'],
        ],
      ],
      [
        'Free checks',
        [
          ['Is GPTBot blocked?', '/ai-readiness-checker'],
          ['JavaScript-only content?', '/blog/can-ai-crawlers-see-javascript'],
          ['robots.txt for AI', '/blog/block-ai-crawlers-robots-txt'],
        ],
      ],
      [
        'Company and legal',
        [
          ['About', 'planned'],
          ['Contact', 'planned'],
          ['Privacy', '/privacy'],
          ['Terms', '/terms'],
          ['Acceptable use', '/aup'],
          ['Refunds', 'planned'],
          ['DPA', 'planned'],
          ['Subprocessors', '/subprocessors'],
          ['Cookie settings', 'control:cookie-settings'],
        ],
      ],
    ]);
  });

  it('keeps four top-level header items, with Developers moved under Learn', () => {
    expect(MARKETING_NAV.map((e) => e.label)).toEqual([
      'Product',
      'For agencies',
      'Learn',
      'Pricing',
    ]);
    const learn = MARKETING_NAV.find(isGroup);
    expect(learn?.label).toBe('Learn');
    expect(learn?.items.map((i) => [i.label, i.planned ? 'planned' : i.href])).toEqual([
      ['Blog', '/blog'],
      ['Research', '/blog'],
      ['Guides', '/guides'],
      ['Docs', 'planned'],
      ['Developers', '/developers'],
    ]);
    expect(MARKETING_NAV.filter(isGroup)).toHaveLength(1);
    expect(MARKETING_NAV.map((e) => e.label)).not.toContain('Developers');
    expect(LOG_IN).toEqual({ label: 'Log in', href: '/login' });
  });

  // Each note states something about another page's code; these keep the statement true, and
  // fail when that page changes so the entry can change with it.
  const noteOf = (label: string) => {
    const i = [...footerItems, ...navLinks].find((x) => x.label === label);
    return i && 'note' in i ? (i.note ?? '') : '';
  };
  const appSource = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

  it('says why Research points at the whole blog, and the blog still has no tags', () => {
    expect(noteOf('Research')).toMatch(/no tags/);
    expect(appSource('blog', 'page.tsx')).not.toMatch(/searchParams|\btags?\b/);
    expect(readFileSync(join(WEB_ROOT, 'lib', 'blog', 'posts.ts'), 'utf8')).not.toMatch(
      /\btags?\??:/,
    );
  });

  it('says why Refunds is planned, and /terms still holds the refund terms with no anchor', () => {
    expect(noteOf('Refunds')).toMatch(/no anchor/);
    const terms = appSource('terms', 'page.tsx');
    expect(terms).toMatch(/8\. Billing/);
    expect(terms).toMatch(/refund/);
    expect(terms).not.toMatch(/\bid=/);
  });

  it('says what the checker reads, and the checker page still says it', () => {
    expect(noteOf('Is GPTBot blocked?')).toMatch(/access matrix/);
    const checker = appSource('ai-readiness-checker', 'page.tsx');
    expect(checker).toMatch(/per-crawler access matrix/);
    expect(checker).toMatch(/GPTBot/);
  });

  it('serves a live page at every href, header and footer', () => {
    const hrefs = [...liveLinks(footerItems), ...liveLinks(navLinks), LOG_IN].map((l) => l.href);
    expect(hrefs.length).toBeGreaterThan(15);
    expect(hrefs.filter((h) => !served(h))).toEqual([]);
  });

  it('tells a path the app does not serve from one it does, on each branch of the check', () => {
    expect(served('/blog')).toBe(true);
    expect(served('/')).toBe(true);
    expect(served('/blog/can-ai-crawlers-see-javascript')).toBe(true);
    expect(served('/changelog')).toBe(false);
    expect(served('/blog/no-such-post')).toBe(false);
    expect(served('/v2-preview')).toBe(false);
    expect(served('/blog?tag=research')).toBe(false);
    expect(served('/status#now')).toBe(false);
    expect(served('#')).toBe(false);
    expect(served('mailto:support@crawlmouse.com')).toBe(false);
  });

  describe('against the sitemap', () => {
    let urls: string[] = [];
    beforeAll(async () => {
      const sitemap = (await import('../../app/sitemap')).default;
      urls = (await sitemap()).map((e) => e.url);
    });

    it('lists every footer target in the sitemap: the footer links only indexed pages', () => {
      expect(urls.length).toBeGreaterThan(10);
      const url = (p: string) =>
        p === '/' ? 'https://crawlmouse.com' : `https://crawlmouse.com${p}`;
      expect(liveLinks(footerItems).filter((l) => !urls.includes(url(l.href)))).toEqual([]);
    });
  });

  it('marks a planned entry with no href, and a live one with no planned flag', () => {
    for (const i of [...footerItems, ...navLinks]) {
      if ('control' in i) continue;
      expect(i.planned === true, i.label).toBe(!('href' in i && i.href));
    }
  });
});

const html = (status?: ServiceStatus) => renderToStaticMarkup(<SiteFooter status={status} />);

/** The footer's column navigation, cut out of the markup. */
const footerNav = (markup: string) => {
  const m = /<nav [^>]*aria-label="Footer"[^>]*>([\s\S]*?)<\/nav>/.exec(markup);
  if (!m) throw new Error('no footer nav');
  return m[1] ?? '';
};

describe('SiteFooter', () => {
  it('carries the brand block: brand link, the one line, the company, the email, the year', () => {
    const out = html();
    expect(out).toMatch(/<a [^>]*aria-label="Crawlmouse home"/);
    expect(out).toMatch(/data-v2-wordmark="">crawl<span [^>]*>mouse<\/span>/);
    // The brief's words, independent of the constants that render them.
    expect(FOOTER_COPY.line).toBe(
      'Crawlmouse fetches your site as each AI crawler and tells you when that changes.',
    );
    expect(FOOTER_COPY.company).toBe('Nahl Technologies Inc. · Indianapolis');
    expect(SUPPORT_EMAIL).toBe('support@crawlmouse.com');
    expect(out).toContain(FOOTER_COPY.line);
    expect(out).toContain(FOOTER_COPY.company);
    expect(out).toContain(`>${SUPPORT_EMAIL}<`);
    expect(out).toContain('>Copy address</button>');
    expect(out).toMatch(new RegExp(`data-v2-year="">${new Date().getFullYear()}<`));
  });

  it('shows the email as text, not as a link', () => {
    expect(html()).not.toContain('mailto:');
  });

  it('heads each column, in the map’s order', () => {
    const titles = [...html().matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(titles).toEqual(FOOTER_COLUMNS.map((c) => c.title));
  });

  it('renders a link for each live entry and plain text for each planned one, never a dead link', () => {
    const nav = footerNav(html());
    const links = [...nav.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
      m[1],
      (m[2] ?? '')
        .replace(/<svg[\s\S]*?<\/svg>/g, '')
        .replace(/<span [^>]*data-v2-sr-only[\s\S]*?<\/span>/g, ''),
    ]);
    expect(links).toEqual(liveLinks(footerItems).map((l) => [l.href, l.label]));
    const planned = [...nav.matchAll(/<span [^>]*data-v2-planned=""[^>]*>([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(planned).toEqual(
      footerItems.filter((i) => 'planned' in i && i.planned).map((i) => i.label),
    );
    expect(nav).not.toMatch(/href="#?"/);
  });

  it('renders Cookie settings as a button', () => {
    expect(footerNav(html())).toMatch(/<button type="button"[^>]*>Cookie settings<\/button>/);
  });

  const STATUS: [ServiceStatus | undefined, string, string, string | null][] = [
    ['ok', 'ok', '●', 'operational'],
    ['degraded', 'warn', '▲', 'degraded'],
    ['down', 'bad', '■', 'down'],
    [undefined, 'unverified', '○', null],
  ];

  it.each(STATUS)(
    'draws the status %s as the %s shape %s, and says it in words',
    (status, glyph, char, word) => {
      const link =
        /<a [^>]*href="\/status"[^>]*>([\s\S]*?)<\/a>/.exec(footerNav(html(status)))?.[1] ?? '';
      expect(link).toContain(`data-v2-glyph="${glyph}"`);
      expect(link).toContain(`data-v2-glyph-char="${char}"`);
      expect(link).toMatch(/<svg [^>]*aria-hidden="true"/);
      const spoken = /data-v2-sr-only="">([^<]*)</.exec(link)?.[1] ?? null;
      expect(spoken).toBe(word === null ? null : `: ${word}`);
    },
  );

  it('shows a muted status by default, distinct from each known state', () => {
    const states = STATUS.map(([s]) => /data-v2-status="(\w+)"/.exec(html(s))?.[1]);
    expect(states).toEqual(['ok', 'degraded', 'down', 'unknown']);
  });

  it('makes no network call: rendering it never reaches fetch, and the sources name no transport', () => {
    const spy = vi.fn(() => {
      throw new Error('the footer fetched');
    });
    const real = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      html('ok');
      html();
    } finally {
      globalThis.fetch = real;
    }
    expect(spy).not.toHaveBeenCalled();
    for (const file of [
      'SiteFooter.tsx',
      'CopyEmail.tsx',
      'CookieSettings.tsx',
      'footer-links.ts',
    ]) {
      const src = readFileSync(join(WEB_ROOT, 'components', 'v2', file), 'utf8');
      expect(src, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|sendBeacon/);
    }
  });

  it('is the footer PageShell renders', () => {
    const shell = renderToStaticMarkup(
      <PageShell status="degraded">
        <main>x</main>
      </PageShell>,
    );
    expect(shell).toContain(renderToStaticMarkup(<SiteFooter status="degraded" />));
  });

  it('styles links in the muted colour with a visible hover, from tokens, with a hairline top rule', () => {
    const css = readFileSync(join(WEB_ROOT, 'components', 'v2', 'SiteFooter.module.css'), 'utf8');
    expect(css).toMatch(/\.footer \{[^}]*border-top: 1px solid var\(--v2-line\)/);
    expect(css).toMatch(/\.list a \{[^}]*color: var\(--v2-mut\)/);
    expect(css).toMatch(/\.list a:hover[^{]*\{[^}]*color: var\(--v2-fg\)/);
    expect(css).toMatch(/\.control:focus-visible \{[^}]*outline: 2px solid var\(--v2-fg\)/);
    // Tokens only: no literal colour anywhere in the footer's styles.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});

describe('the footer’s two controls', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(el));
    return host;
  }

  const setClipboard = (writeText: ((s: string) => Promise<void>) | undefined) =>
    Object.defineProperty(navigator, 'clipboard', {
      value: writeText ? { writeText } : undefined,
      configurable: true,
    });

  it('copies the address and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    const host = mount(<CopyEmail address={SUPPORT_EMAIL} />);
    await act(async () => host.querySelector('button')?.click());
    expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Copied');
  });

  it('clears the notice after a moment', async () => {
    vi.useFakeTimers();
    setClipboard(() => Promise.resolve());
    const host = mount(<CopyEmail address={SUPPORT_EMAIL} />);
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Copied');
    await act(async () => vi.advanceTimersByTime(4000));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it.each([
    ['no clipboard API', undefined],
    ['a refused write', () => Promise.reject(new Error('denied'))],
  ])('selects the address for the reader to copy when there is %s', async (_, writeText) => {
    setClipboard(writeText);
    const host = mount(<CopyEmail address={SUPPORT_EMAIL} />);
    await act(async () => host.querySelector('button')?.click());
    expect(window.getSelection()?.toString()).toBe(SUPPORT_EMAIL);
    expect(host.querySelector('[role="status"]')?.textContent).toMatch(/^Selected/);
  });

  it('keeps the address as selectable text, with its status region empty until used', () => {
    setClipboard(undefined);
    const host = mount(<CopyEmail address={SUPPORT_EMAIL} />);
    expect(host.textContent).toContain(SUPPORT_EMAIL);
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('opens the consent banner from Cookie settings, through CONSENT_OPEN_EVENT', () => {
    const heard = vi.fn();
    window.addEventListener(CONSENT_OPEN_EVENT, heard);
    try {
      const host = mount(<CookieSettings />);
      act(() => host.querySelector('button')?.click());
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(CONSENT_OPEN_EVENT, heard);
    }
  });
});
