import type { Check, FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import type { PerturbTable } from './types';

/** The page of check `c` at `path` on its site. */
export function pageOf(c: Check, d: FixtureDataset, path: string): PageResult {
  const p = d.page_results.find((x) => x.check_id === c.id && new URL(x.url).pathname === path);
  if (!p) throw new Error(`No page ${path} in check ${c.id}`);
  return p;
}

export const LINKS_PERTURB: PerturbTable = {
  'links-broken': {
    'page_results[].status_code': [
      {
        change: (c, d) => (pageOf(c, d, '/products/trail-mug').status_code = 410),
        expect: { links: ['answering 410'] },
      },
    ],
  },
  'links-redirect': {
    'page_results[].redirect': [
      {
        change: (c, d) => {
          const p = pageOf(c, d, '/products/trail-mug');
          p.redirect = {
            hops: [{ from: p.url, status: 301, location: `${new URL(p.url).origin}/moved-here` }],
            loop: false,
          };
        },
        expect: { links: ['301 → /moved-here'] },
      },
    ],
  },
  'links-title': {
    'page_results[].title.text': [
      {
        change: (c, d) => {
          for (const path of ['/products/trail-mug', '/products/alpine-stove']) {
            pageOf(c, d, path).title!.text = 'A title two pages share';
          }
        },
        expect: { links: ['“A title two pages share” · 2 pages'] },
      },
    ],
  },
  'links-description': {
    'page_results[].meta_description.text': [
      {
        change: (c, d) => {
          for (const p of d.page_results.filter((x) => x.check_id === c.id)) {
            if (p.meta_description) p.meta_description.text = null as unknown as string;
          }
        },
        expect: { links: ['Missing: 16 pages'] },
      },
    ],
  },
};
