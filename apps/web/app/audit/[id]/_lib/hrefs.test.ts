/**
 * The addresses of a v2 check's pages (CC-22b D4) come from `auditHrefs` and `auditHref`
 * (lib/v2/view/audit-hrefs.ts). The scan below reads the v2 source for an address written out by
 * hand; it sees a template literal that starts `/audit/${`, and no other spelling.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditHref, auditHrefs } from '../../../../lib/v2/view/audit-hrefs';
import { segmentKeyOf } from './hrefs';

const WEB = join(__dirname, '../../../..');
const ID = 'b0000000-0000-4000-8000-0000000000c1';

describe('auditHrefs', () => {
  it('builds each page’s path under the check’s own', () => {
    const h = auditHrefs(ID);
    expect(auditHref(ID)).toBe('/audit/b0000000-0000-4000-8000-0000000000c1');
    expect(h.overview).toBe('/audit/b0000000-0000-4000-8000-0000000000c1/overview');
    expect(h.segment('nojs')).toBe('/audit/b0000000-0000-4000-8000-0000000000c1/nojs');
    expect(h.fix('f1')).toBe('/audit/b0000000-0000-4000-8000-0000000000c1/fix/f1');
    expect(h.map).toEqual({
      hubs: '/audit/b0000000-0000-4000-8000-0000000000c1/map',
      all: '/audit/b0000000-0000-4000-8000-0000000000c1/map?scope=all',
    });
    expect(h.check('other')).toBe('/audit/other');
  });

  it('names a segment by its path part, and nothing else', () => {
    expect(segmentKeyOf('access')).toBe('access');
    expect(segmentKeyOf('overview')).toBeNull();
  });
});

describe('an audit address written out by hand in the v2 source', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const HAND_BUILT = /`\/audit\/\$\{/;
  const found = ['app/audit/[id]', 'app/v2-home', 'components/v2', 'lib/v2']
    .flatMap((dir) => sources(join(WEB, dir)))
    .filter((file) => HAND_BUILT.test(readFileSync(file, 'utf8')))
    .map((file) => relative(WEB, file))
    .sort();

  /** Where one may stand: the builder, and two files this scan's owner does not edit. */
  const ALLOWED = [
    // The builder itself.
    'lib/v2/view/audit-hrefs.ts',
    // The v1 audit page's own canonical, which is main's line.
    'app/audit/[id]/page.tsx',
    // The live crawl's link to the result.
    'app/audit/[id]/_crawl/LiveCrawl.tsx',
  ];

  it('is found in the builder, so the scan reads the source', () => {
    expect(found).toContain('lib/v2/view/audit-hrefs.ts');
  });

  it('is found nowhere but the files listed', () => {
    expect(found.filter((file) => !ALLOWED.includes(file))).toEqual([]);
  });

  it('in the v1 page is the canonical alone', () => {
    const page = readFileSync(join(WEB, 'app/audit/[id]/page.tsx'), 'utf8');
    expect(page.match(/`\/audit\/\$\{[^`]*`/g)).toEqual(['`/audit/${id}`']);
  });
});
