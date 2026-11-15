/**
 * The CC-33 previews render, each with the number of orange elements its registry row states: none
 * on the help centre, which asks nothing of the reader, and "Try again" on the error screen.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PREVIEWS } from '../../app/(v2-preview)/v2-preview/_preview/registry';

const PAGES = {
  '/v2-preview/screens/help': () => import('../../app/(v2-preview)/v2-preview/screens/help/page'),
  '/v2-preview/screens/help-article': () =>
    import('../../app/(v2-preview)/v2-preview/screens/help-article/page'),
  '/v2-preview/screens/error': () => import('../../app/(v2-preview)/v2-preview/screens/error/page'),
} as const;

describe.each(Object.entries(PAGES))('%s', (path, load) => {
  it('renders one h1 and the orange elements its row states', async () => {
    const row = PREVIEWS.find((p) => p.path === path)!;
    expect(row).toBeDefined();
    const { default: Page } = await load();
    const html = renderToStaticMarkup((Page as () => ReactElement)());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect((html.match(/data-v2-primary=""/g) ?? []).length).toBe(row.orange ?? 1);
  });
});
