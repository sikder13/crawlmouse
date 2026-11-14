import { expect, test } from './pw';
import { control, NEEDS_SEED, qa, SEEDED, shot, signIn, sql } from './walk';

/**
 * Journey 2 (CC-38 D4): `qa+free` on Free — the seeded site's first check, a fix's packet, Mark done,
 * the re-check it starts, the before/after, and the upgrade gate when a second site is added.
 */
const J = '2-free';

test.skip(!SEEDED, NEEDS_SEED);

test('Free: check, fix packet, mark done, re-check, before/after, the second-site gate', async ({
  page,
  context,
}) => {
  await signIn(context, qa('free'));
  const [site] = await sql<{ id: string; host: string }>(
    `select s.id, s.host from public.sites s join public.qa_accounts q on q.account_id = s.account_id
      where q.qa_key = 'free' and s.removed_at is null`,
  );
  expect(site?.host).toBe('nahltech.com');
  await control('finish', { siteId: site!.id });

  await page.goto('/dashboard');
  await expect(page.getByText('nahltech.com').first()).toBeVisible();
  await shot(page, J, 'dashboard');

  // The fix the dashboard puts first, and its packet.
  await page.getByRole('link', { name: /^Start with fix/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, J, 'fix-packet');

  // Mark done is on the site's own page, on each fix row still to do.
  await page.goto(`/sites/${site!.id}`);
  await shot(page, J, 'site');
  const recheck = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/'),
  );
  await page
    .getByRole('button', { name: /Mark done/ })
    .first()
    .click();
  expect((await recheck).status()).toBeLessThan(400);
  await shot(page, J, 'marked-done');
  const queued = await sql<{ n: number }>(
    `select count(*)::int n from public.checks where site_id = $1 and status = 'queued'`,
    [site!.id],
  );
  expect(queued[0]?.n).toBe(1);

  // The re-check finishes; the fix's before/after is on its page.
  await control('finish', { siteId: site!.id });
  await page.reload();
  // Two checks now, and the fix marked done carries the re-check's verdict. The recorded second crawl
  // resolves the orphan fix, not this one, so the re-check does not agree and it stays open.
  await expect(page.getByText('Grades, two checks')).toBeVisible();
  await expect(page.getByText(/marked done .*did not agree, so it stays open/)).toBeVisible();
  await shot(page, J, 'after-recheck');
  await page.goto('/changes');
  await shot(page, J, 'changes');

  // A second site on Free: the gate, not a second site.
  await page.goto('/dashboard');
  await page
    .getByRole('link', { name: /Add a site/ })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  // The gate: the plans, with Free as this account's.
  await expect(page.getByText('The plan your account is on now')).toBeVisible();
  await shot(page, J, 'add-site');
  const sites = await sql<{ n: number }>(
    `select count(*)::int n from public.sites where account_id = (select account_id from public.qa_accounts where qa_key = 'free' limit 1) and removed_at is null`,
  );
  expect(sites[0]?.n).toBe(1);
});
