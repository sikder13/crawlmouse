/**
 * The links_read gate (scope.ts `linksIncomplete`) is about HTML pages that answered 200: only they
 * have links the crawl reads. A complete crawl that also holds a redirect, a 404, a 410, a non-HTML
 * resource and a URL robots.txt excludes for every crawler still decides deep_pages and orphan_pages;
 * one HTML 200 page with links not all read makes both undecided.
 */
import { describe, expect, it } from 'vitest';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectDeepPages } from './deep-pages.js';
import { detectOrphans } from './orphans.js';
import type { Detection } from './types.js';

/**
 * Home → /a → /b → /c → /d: /d is 4 clicks deep. /lonely has no link to it. Home also links to a
 * redirect, a 404, a 410, a PDF served as application/pdf and /cart (disallowed for every crawler).
 */
const SHAPE: PageSpec[] = [
  { path: '/', links: ['/a', '/moved', '/gone', '/removed', '/guide.pdf', '/cart'] },
  { path: '/a', links: ['/b'] },
  { path: '/b', links: ['/c'] },
  { path: '/c', links: ['/d'] },
  { path: '/d', links: ['/'] },
  { path: '/lonely', links: ['/'] },
  { path: '/moved', status: 301, kind: 'status', facts: { final_url: u('/a') } },
  { path: '/gone', status: 404, kind: 'status' },
  { path: '/removed', status: 410, kind: 'status' },
  { path: '/guide.pdf', kind: 'utility', facts: { html: false, links_read: false } },
];
const complete = (specs: PageSpec[]) => site(specs, { disallowed: [{ path: '/cart' }] });

const of = (out: Detection[], key: string) => out.find((d) => d.key === key);

describe('the links_read gate', () => {
  it('a complete crawl with redirects, 404 and 410 pages, a non-HTML resource and an excluded URL decides', () => {
    const input = complete(SHAPE);
    expect(of(detectDeepPages(input), `depth:${u('/d')}`)).toMatchObject({ state: 'detected' });
    expect(of(detectDeepPages(input), `depth:${u('/c')}`)).toMatchObject({ state: 'not_detected' });
    expect(of(detectOrphans(input), `orphan:${u('/lonely')}`)).toMatchObject({
      state: 'detected',
    });
    expect(of(detectOrphans(input), `orphan:${u('/b')}`)).toMatchObject({ state: 'not_detected' });
  });

  it('one HTML 200 page whose links were not all read leaves both undecided', () => {
    const unread = SHAPE.map((s) => (s.path === '/b' ? { ...s, facts: { links_read: false } } : s));
    const input = complete(unread);
    for (const d of [
      of(detectDeepPages(input), `depth:${u('/d')}`),
      of(detectOrphans(input), `orphan:${u('/lonely')}`),
    ]) {
      expect(d).toMatchObject({ state: 'indeterminate', reason: 'links_not_fully_recorded' });
    }
  });

  it('a non-HTML 200 resource never trips it, whatever its links_read', () => {
    const pdf = complete(SHAPE);
    expect(pdf.pages.find((p) => p.url === u('/guide.pdf'))).toMatchObject({
      status_code: 200,
      is_html: false,
      links_read: false,
    });
    expect(of(detectOrphans(pdf), `orphan:${u('/lonely')}`)).toMatchObject({ state: 'detected' });
  });
});
