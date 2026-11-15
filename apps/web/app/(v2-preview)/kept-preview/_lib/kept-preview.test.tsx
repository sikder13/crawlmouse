/**
 * The kept-page previews the visual harness screenshots (CC-36 D3): one render for each page in
 * the index, each a page whose address is rewritten to a kept target, each drawn in the v2 shell.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { rewriteOf } from '@/lib/v2/rewrites';
import { KEPT_PREVIEW_INDEX } from './kept-index';
import { KEPT_RENDERS } from './kept-renders';

vi.mock('next/navigation', async (actual) => ({
  ...(await actual<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

describe('the kept-page previews', () => {
  it('has one render for each page in the index, and no other', () => {
    expect(Object.keys(KEPT_RENDERS).sort()).toEqual(KEPT_PREVIEW_INDEX.map((p) => p.slug).sort());
  });

  it.each(KEPT_PREVIEW_INDEX)(
    '$v1 is a kept page, and its preview is drawn in the v2 shell',
    async (p) => {
      expect(rewriteOf(p.v1)?.to).toBe(`/v2-kept${p.v1}`);
      const markup = renderToStaticMarkup(<>{await KEPT_RENDERS[p.slug]!()}</>);
      expect(markup).toContain('data-v2-shell=""');
      expect(markup).toContain('data-v1-content=""');
      expect(markup.match(/<h1[\s>]/g)).toHaveLength(1);
    },
    60_000,
  );
});
