import { expect, test } from './pw';
import { V1_CUTOVER } from '../../apps/web/lib/v2/cutover';
import { shot } from './walk';

/**
 * Journey 6 (CC-38 D4): each retired v1 address in CC-36's table answers as the table says, on the
 * production build with the flags on. The rows are read from `V1_CUTOVER` itself
 * (apps/web/lib/v2/cutover.ts), not a copy, so a row added there is walked here.
 */
const J = '6-v1-urls';

/** A request path for a row: each `:name` given a URL-safe value, a last `*` one segment. */
const pathOf = (from: string) => from.replace(/:([a-z]+)/g, 'walk1').replace(/\*$/, 'walk');

for (const row of V1_CUTOVER) {
  const path = pathOf(row.from);
  test(`${row.from} answers ${row.answer.kind}`, async ({ request, page }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    switch (row.answer.kind) {
      case 'redirect': {
        expect(res.status()).toBe(row.answer.status);
        const to = row.answer.to.replace(/:([a-z]+)/g, 'walk1');
        expect(new URL(res.headers()['location']!, 'http://x').pathname).toBe(to);
        break;
      }
      case 'gone-page': {
        expect(res.status()).toBe(410);
        expect(res.headers()['content-type']).toContain('text/html');
        await page.goto(path);
        await shot(page, J, 'gone-page');
        break;
      }
      case 'gone-api': {
        expect(res.status()).toBe(410);
        if (row.answer.replacement !== null) {
          expect(await res.text()).toContain(row.answer.replacement);
        }
        break;
      }
      case 'not-found':
        expect(res.status()).toBe(404);
        break;
    }
    // A retired row's answer is not kept by a browser past a rollback (36-cutover.md, "Caching").
    expect(res.headers()['cache-control']).toContain('no-store');
  });
}
