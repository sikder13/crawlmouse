import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page, TestInfo } from '../pw';
import { signIn, stagingAdmin } from './accounts';
import { person, type Person } from './people';

/**
 * J2's one Pro customer, kept across runs: each locked run against staging is bounded, and a weekly
 * re-check spans the hour between two of them. The state file holds test addresses and ids, no secret.
 * `JOURNEY_J2_DIR` names where it and the evidence go; without it, the run's output directory.
 */
export interface ProState {
  email: string;
  userId: string;
  accountId: string;
}

export const j2Dir = (info: TestInfo): string => {
  const dir = process.env.JOURNEY_J2_DIR ?? join(info.project.outputDir, 'j2');
  mkdirSync(dir, { recursive: true });
  return dir;
};

const stateFile = (info: TestInfo) => join(j2Dir(info), 'customer.json');

export function readProState(info: TestInfo): ProState | null {
  const file = stateFile(info);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProState) : null;
}

/** Text evidence under the J2 directory. */
export function keep(info: TestInfo, name: string, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  writeFileSync(join(j2Dir(info), name), `${text}\n`);
}

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: join(j2Dir(info), `${name}.png`), fullPage: true });
}

/** The page's main text, for evidence and for what a customer reads. */
export const mainText = async (page: Page): Promise<string> =>
  (await page.locator('main').first().innerText()).replace(/[ \t]+/g, ' ').trim();

/**
 * Presses the dashboard's "Start 14 days of Pro" with staging's trial ledger set aside: test addresses
 * normalise to one mailbox (the `+tag` is dropped) and every run comes from one network, so the ledger
 * would refuse them all. The rows are put back, in `finally`, exactly as read, and the row this trial
 * wrote goes with the set-aside, as the gate scripts' `realTrial` does.
 */
export async function startTrialFromDashboard(
  who: Person,
): Promise<{ status: number; location: string | null }> {
  const db = stagingAdmin();
  let answer: { status: number; location: string | null } | null = null;
  const {
    data: held,
    error,
    count,
  } = await db.from('trial_ledger').select('*', { count: 'exact' }).range(0, 999);
  if (error || !held) throw new Error('could not read the trial ledger');
  if (count !== held.length) throw new Error('the ledger has more rows than were read');
  try {
    if (held.length > 0) {
      const gone = await db.from('trial_ledger').delete().not('id', 'is', null);
      if (gone.error) throw new Error('could not set the ledger rows aside');
    }
    await who.page.goto('/dashboard');
    const answered = who.page.waitForResponse(
      (r) => r.url().includes('/api/billing/pro-trial/start') && r.request().method() === 'POST',
      { timeout: 45_000 },
    );
    await who.page
      .locator('main')
      .first()
      .getByRole('button', { name: /Start 14 days/i })
      .first()
      .click();
    const response = await answered;
    answer = { status: response.status(), location: response.headers()['location'] ?? null };
    await who.page.waitForLoadState('load');
  } finally {
    await db.from('trial_ledger').delete().not('id', 'is', null);
    if (held.length > 0) {
      const back = await db.from('trial_ledger').insert(held);
      if (back.error) throw new Error('the ledger rows were not restored');
    }
  }
  return answer!;
}

/** The kept customer signed in, or a new Free person when there is none yet. */
export async function proCustomer(
  context: BrowserContext,
  baseURL: string,
  info: TestInfo,
): Promise<Person & { isNew: boolean }> {
  const kept = readProState(info);
  if (kept) {
    const page = await context.newPage();
    await signIn(page, baseURL, kept.email);
    return { ...kept, context, page, isNew: false };
  }
  const who = await person(context, baseURL, 'j2', 1);
  const state: ProState = { email: who.email, userId: who.userId, accountId: who.accountId };
  writeFileSync(stateFile(info), JSON.stringify(state));
  return { ...who, isNew: true };
}

/** A check's status on staging, polled until it has a result or `ms` runs out. */
export async function waitForResult(checkId: string, ms: number): Promise<string> {
  const db = stagingAdmin();
  const deadline = Date.now() + ms;
  for (;;) {
    const { data, error } = await db.from('checks').select('status').eq('id', checkId).single();
    if (error || !data) throw new Error(`no check ${checkId}`);
    const status = data.status as string;
    if (['finished', 'partial', 'failed', 'cancelled'].includes(status)) return status;
    if (Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
