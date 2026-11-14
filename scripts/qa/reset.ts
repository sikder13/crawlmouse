import { QA_KEYS, type QaKey } from './accounts';
import { noter, seed, type SeedDeps, type Step } from './seed';

/**
 * `pnpm qa:reset` (CC-38 D2): every account in `qa_accounts` back to its starting sites, checks,
 * fixes and seats. The deleting is `qa_reset(p_account)`'s, a service-role SQL function that refuses
 * an account without its `qa_accounts` row or with `accounts.internal` false (migration
 * 20261117000002); this script holds no such check of its own, so nothing here can widen it. The
 * seed's sites and seat steps then put the starting set back (./seed.ts `only: 'sites-and-seats'`).
 * The plan, Stripe and the account row are not touched.
 */

export interface ResetStore {
  /** Every `qa_accounts` row. */
  marked(): Promise<{ accountId: string; key: string }[]>;
  /** `qa_reset`: what it removed, or the function's refusal. */
  reset(accountId: string): Promise<{ sites: number; seats: number } | { refused: string }>;
}

export interface ResetDeps extends SeedDeps {
  reset: ResetStore;
}

const isQaKey = (k: string): k is QaKey => (QA_KEYS as readonly string[]).includes(k);

export async function reset(deps: ResetDeps): Promise<Step[]> {
  const steps: Step[] = [];
  for (const row of await deps.reset.marked()) {
    const note = noter(steps, deps.print, isQaKey(row.key) ? row.key : 'run');
    const r = await deps.reset.reset(row.accountId);
    if ('refused' in r) note('reset', 'refused', `${row.accountId}: ${r.refused}`);
    else note('reset', 'done', `${row.accountId}: ${r.sites} sites, ${r.seats} seats removed`);
  }
  steps.push(...(await seed(deps, { only: 'sites-and-seats' })));
  return steps;
}
