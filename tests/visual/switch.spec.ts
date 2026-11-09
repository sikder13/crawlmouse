import { test, expect } from './pw';
import { openPreview } from './pages';

/**
 * The Switch primitive in a real browser: what it posts is read where the browser reads it, in a
 * capturing `submit` listener, after the click has been handled. jsdom cannot show this: React
 * re-renders inside `act()` there, so a switch that posts the wrong value passes a jsdom test.
 */
const PAGE = '/v2-preview/switch';

test.describe('Switch', () => {
  test.beforeEach(async ({ page }) => {
    await openPreview(page, PAGE);
    await page.evaluate(() => {
      const w = window as unknown as { posted: (string | null)[] };
      w.posted = [];
      document.addEventListener(
        'submit',
        (e) => w.posted.push(new FormData(e.target as HTMLFormElement).get('enabled') as string),
        true,
      );
    });
  });

  const posted = (page: import('./pw').Page) =>
    page.evaluate(() => (window as unknown as { posted: (string | null)[] }).posted);

  test('a click on an on switch posts off, and the switch reads off', async ({ page }) => {
    const on = page.getByRole('switch', { name: 'A crawler becomes blocked' });
    await expect(on).toHaveAttribute('aria-checked', 'true');
    await on.click();
    expect(await posted(page)).toEqual(['false']);
    await expect(on).toHaveAttribute('aria-checked', 'false');
  });

  test('Space on an off switch posts on, and a second press posts off again', async ({ page }) => {
    const off = page.getByRole('switch', { name: 'Any change at all, including content' });
    await off.focus();
    await page.keyboard.press('Space');
    await expect(off).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(off).toHaveAttribute('aria-checked', 'false');
    expect(await posted(page)).toEqual(['true', 'false']);
  });
});
