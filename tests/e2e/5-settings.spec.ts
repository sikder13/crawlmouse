import type { Page } from './pw';
import { expect, test } from './pw';
import { accountLinkUrl } from '../../apps/web/lib/v2/mail/links';
import { control, events, shot, signIn, sql } from './walk';

/**
 * Journey 5 (CC-38 D4): Settings — change the sign-in address, then delete the account and restore
 * it. Each emailed link is minted as the mailer mints it, from the recorded `email.requested`
 * (`issue_account_link`), and built by the mailer's own `accountLinkUrl`; nothing is mailed. It uses
 * an account of its own, so the QA set's addresses stay as seeded for the other journeys.
 */
const J = '5-settings';
const FIRST = 'settings@walk.example';
const SECOND = 'settings-new@walk.example';
/** Deletion waits out an email change's 7-day undo window (027b `email_change_live`): its own account. */
const LEAVING = 'leaving@walk.example';

test.describe.configure({ mode: 'serial' });

/** The links the mailer would send for the newest `email.requested` of this template. */
async function mailed(template: string): Promise<{ kind: string; path: string }[]> {
  const sent = (await events('email.requested')).filter((e) => e.data.template === template);
  const last = sent.at(-1);
  expect(last, `an ${template} email was requested`).toBeDefined();
  const rows = await sql<{ kind: string; token: string }>(
    `select kind, token from public.issue_account_link($1)`,
    [last!.data.tokenId],
  );
  return rows.map((r) => ({
    kind: r.kind,
    path: new URL(accountLinkUrl(r.kind as never, r.token)).pathname,
  }));
}

async function signedIn(page: Page, email: string): Promise<void> {
  await signIn(page.context(), email);
}

test('the sign-in address changes through its confirmation link', async ({ page }) => {
  await control('user', { email: FIRST });
  await signedIn(page, FIRST);
  await page.goto('/settings');
  await shot(page, J, 'settings');
  await page.getByLabel('Email', { exact: true }).fill(SECOND);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'change-asked');

  const links = await mailed('email_change_confirm');
  const confirm = links.find((l) => l.kind === 'email_change');
  expect(confirm).toBeDefined();
  await page.goto(confirm!.path);
  await shot(page, J, 'change-link');
  await page
    .getByRole('button')
    .filter({ hasText: /confirm|change|continue/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'changed');
  const [user] = await sql<{ email: string }>(
    `select u.email from auth.users u where u.email in ($1, $2)`,
    [FIRST, SECOND],
  );
  expect(user?.email).toBe(SECOND);
});

test('the account is deleted through its confirmation link, then restored', async ({ page }) => {
  await control('user', { email: LEAVING });
  await signedIn(page, LEAVING);
  await page.goto('/settings');
  await page.getByRole('link', { name: /^Delete/ }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'delete-page');
  await page.getByRole('textbox').first().fill(LEAVING);
  await page
    .getByRole('button', { name: /delete|send/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'delete-asked');

  const links = await mailed('account_delete');
  const confirm = links.find((l) => l.kind === 'delete_confirm');
  const restore = links.find((l) => l.kind === 'delete_restore');
  expect(confirm && restore, JSON.stringify(links.map((l) => l.kind))).toBeTruthy();
  await page.goto(confirm!.path);
  await shot(page, J, 'delete-link');
  await page
    .getByRole('button')
    .filter({ hasText: /delete|confirm/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'deleted');
  const deleted = async () =>
    (
      await sql<{ deleted: boolean }>(
        `select a.deletion_confirmed_at is not null as deleted from public.accounts a
           join public.users u on u.default_account_id = a.id
           join auth.users au on au.id = u.id where au.email = $1`,
        [LEAVING],
      )
    )[0]?.deleted;
  expect(await deleted()).toBe(true);

  await page.goto(restore!.path);
  await shot(page, J, 'restore-link');
  await page
    .getByRole('button')
    .filter({ hasText: /restore/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'restored');
  expect(await deleted()).toBe(false);
});
