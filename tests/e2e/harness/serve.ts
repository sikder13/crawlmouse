/**
 * The walk's back end (CC-38 D4): the stand-in (./standin.ts) with the walk's Stripe (./stripe.ts),
 * seeded with the QA account set by `pnpm qa:seed`'s own `seed()` (scripts/qa/seed.ts) — the walk
 * signs in as the accounts the owner will use. It serves until killed, and writes one JSON line to
 * stdout when ready. Started by ./run.sh. NOT part of the product.
 *
 * Controls added here (POST /__harness/<name>, JSON):
 *   finish   {siteId}        the site's oldest queued check, finished from the recorded crawl
 *   complete {sessionId}     Stripe's side of a finished Checkout, delivered to the webhook
 *   updated  {subscription}  `customer.subscription.updated` for it as it stands, delivered
 *   renew    {subscription}  the billing portal's Renew: the cancellation withdrawn, then `updated`
 *   session  {email}         a signed-in session cookie for that user
 *   user     {email}         a confirmed user at that address, made as a sign-up makes one
 *   sessions {}              the open and finished Checkout Sessions, as the app opened them
 */
import { supabaseEntitlementStore } from '../../../apps/web/lib/billing/state-machine-apply';
import { postgrestOver } from '../../../apps/web/__tests__/helpers/postgrest-pglite';
import { seed } from '../../../scripts/qa/seed';
import { qaStore } from '../../../scripts/qa/store';
import { existsSync } from 'node:fs';
import { finishCheck } from './checks';
import { startStandin, type Standin } from './standin';
import { WalkStripe } from './stripe';

const PORT = Number(process.env.STANDIN_PORT ?? 54438);
const WEB = process.env.WALK_BASE ?? 'http://localhost:3238';
export const QA_INBOX = { local: 'qa', domain: 'walk.example' };
/** The walk's ledger pepper, built from parts; run.sh gives the build the same value. */
const PEPPER = process.env.TRIAL_LEDGER_PEPPER ?? '';
/** CC-33's `accounts.internal`: the set is seeded once its migration is on the tree (questions Q1). */
const HAS_INTERNAL_MARKER = existsSync(
  new URL(
    '../../../infra/supabase/migrations/20261115000001_v2_033_operations.sql',
    import.meta.url,
  ),
);

const stripe = new WalkStripe(() => `${WEB}/api/webhooks/stripe-account`);

function cookieOf(email: string): string {
  const u = standin.auth.byEmail(email);
  if (!u) throw new Error(`walk: no user ${email}`);
  return `base64-${Buffer.from(JSON.stringify(standin.auth.session(u))).toString('base64url')}`;
}

const standin: Standin = await startStandin(PORT, {
  routes: [{ prefix: '/stripe/', handle: (req, res, url) => stripe.handle(req, res, url) }],
  controls: {
    finish: async (b, db) => ({ checkId: await finishCheck(db, String(b.siteId)) }),
    complete: async (b) => stripe.complete(String(b.sessionId)),
    updated: async (b) => stripe.updated(String(b.subscription)),
    renew: async (b) => stripe.renew(String(b.subscription)),
    session: async (b) => ({ name: 'sb-127-auth-token', value: cookieOf(String(b.email)) }),
    user: async (b) => ({ id: (await standin.auth.create(String(b.email))).id }),
    sessions: async () => [...stripe.sessions.values()],
  },
});

const sb = postgrestOver(standin.db);
let steps: unknown[] = [];
if (HAS_INTERNAL_MARKER) {
  steps = await seed({
    auth: {
      async find(email) {
        const u = standin.auth.byEmail(email);
        return u
          ? { id: u.id, qaKey: (u.app_metadata.qa_seed as string | undefined) ?? null }
          : null;
      },
      async create(email, key) {
        return (await standin.auth.create(email, { qa_seed: key })).id;
      },
    },
    store: qaStore(sb, {
      // The first audits go where the app's go: the stand-in's event intake.
      send: async (event) => {
        for (const e of [event].flat()) standin.events.push({ name: e.name, data: e.data });
        return { ids: [] } as never;
      },
      // The lab hosts do not resolve here; no site is fetched in the walk.
      admit: async () => true,
      trial: {
        entitlement: supabaseEntitlementStore(sb),
        admit: async () => true,
        report: (message) => console.error(`seed: ${message}`),
        pepper: PEPPER,
        now: () => new Date(),
        dispatch: async (planned) => {
          for (const p of planned) standin.events.push({ name: 'planned', data: p });
        },
      },
      now: () => new Date(),
    }),
    async markInternal(accountId) {
      // CC-33's ops:internal, as it writes: accounts.internal by id, with the service role.
      await standin.db.query('update public.accounts set internal = true where id = $1', [
        accountId,
      ]);
    },
    inbox: QA_INBOX,
    print: (l) => console.error(`seed: ${l}`),
  });
}

console.log(
  JSON.stringify({
    ready: true,
    url: standin.url,
    seeded: HAS_INTERNAL_MARKER,
    steps: steps.length,
  }),
);
