/**
 * D-31: the dashboard and site pages name themselves in the tab, under the root layout's
 * "%s · Crawlmouse", in place of the product line, and stay out of search.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('signed-in page titles (D-31)', () => {
  it.each([
    // The v2 route serves /dashboard; v1's app/dashboard/page.tsx is held to main's file.
    ['/dashboard (v2 route)', () => import('../../app/dashboard/v2/page'), 'Sites'],
    ['/sites/[id]', () => import('../../app/sites/[id]/page'), 'Site'],
  ])(
    '%s is titled %s',
    async (_, load, title) => {
      const { metadata } = (await load()) as {
        metadata: { title?: string; robots?: { index?: boolean } };
      };
      expect(metadata.title).toBe(title);
      expect(metadata.robots?.index).toBe(false);
    },
    30_000,
  );

  it('the root layout puts each under "· Crawlmouse"', () => {
    // Read as text: the layout loads next/font, which runs only in a Next build.
    const layout = readFileSync(join(__dirname, '..', '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain("template: '%s · Crawlmouse'");
  });
});
