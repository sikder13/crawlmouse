/**
 * The v2 webhook's port (./webhook-db.ts) over PGlite with every migration applied, and a world to
 * run the handler in: that database, the Stripe fake (./stripe.fake.ts) and the fake catalog.
 * Test-only: the webhook tests and the sandbox smoke import it, no route does.
 *
 * Each call is its own transaction as the service role, as each PostgREST request is. PGlite has
 * one connection, so two calls never overlap; `hooks.afterLoad` runs between a decision's read of
 * the account and its write, which is where two real deliveries interleave.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type Stripe from 'stripe';
import { applyAllMigrations, freshDb } from '../../__tests__/helpers/pglite-migrations';
import type { Catalog } from './catalog';
import { fakeCatalog } from './catalog.fake';
import type { EffectSinks } from './effects';
import { snapshotFromRow, type AccountRow } from './state-machine-apply';
import { StripeFake } from './stripe.fake';
import { applyStripeEvent, type WebhookReport } from './stripe-webhook';
import type { WebhookOutcome } from './webhook-types';
import {
  applyEventError,
  ledgerStateOf,
  recordedDecisionOf,
  storedMirrorOf,
  type WebhookDb,
} from './webhook-db';

export interface PgliteHooks {
  afterLoad?: (accountId: string) => Promise<void>;
}

function svc<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return fn(tx);
  });
}

export function pgliteWebhookDb(db: PGlite, hooks: PgliteHooks = {}): WebhookDb {
  return {
    async begin({ id, type, livemode }) {
      return svc(db, async (tx) => {
        const inserted = await tx.query(
          `insert into public.stripe_events (id, type, livemode) values ($1, $2, $3)
           on conflict (id) do nothing returning id`,
          [id, type, livemode],
        );
        if (inserted.rows.length === 1) return { kind: 'new' } as const;
        const { rows } = await tx.query<{
          handled: boolean | null;
          processed_at: Date | null;
          effects: unknown;
        }>(`select handled, processed_at, effects from public.stripe_events where id = $1`, [id]);
        return ledgerStateOf(rows[0]!);
      });
    },
    async recordRefused({ id, type, livemode }, reason) {
      await svc(db, (tx) =>
        tx.query(
          `insert into public.stripe_events (id, type, livemode, handled_reason) values ($1, $2, $3, $4)
           on conflict (id) do nothing`,
          [id, type, livemode, reason],
        ),
      );
    },
    async accountById(id) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{ id: string; stripe_customer_id: string | null }>(
          `select id, stripe_customer_id from public.accounts
            where id::text = $1 and deleted_at is null`,
          [id],
        ),
      );
      return rows[0] ? { id: rows[0].id, stripeCustomerId: rows[0].stripe_customer_id } : null;
    },
    async accountByCustomer(customerId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{ id: string }>(
          `select id from public.accounts where stripe_customer_id = $1 and deleted_at is null`,
          [customerId],
        ),
      );
      return rows[0]?.id ?? null;
    },
    async subscriptionById(id) {
      const { rows } = await svc(db, (tx) =>
        tx.query<Parameters<typeof storedMirrorOf>[0]>(
          `select account_id, plan, interval, seat_quantity, extra_site_quantity
             from public.subscriptions where id = $1`,
          [id],
        ),
      );
      return rows[0] ? storedMirrorOf(rows[0]) : null;
    },
    async load(accountId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<AccountRow>(`select * from public.accounts where id = $1`, [accountId]),
      );
      const stored = rows[0] ? snapshotFromRow(rows[0]) : null;
      await hooks.afterLoad?.(accountId);
      return stored;
    },
    async applyEvent(p) {
      try {
        const { rows } = await svc(db, (tx) =>
          tx.query<{ r: unknown }>(`select public.apply_stripe_event($1::jsonb) as r`, [
            JSON.stringify(p),
          ]),
        );
        return recordedDecisionOf(rows[0]!.r);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (typeof e.code === 'string') throw applyEventError(e.code, e.message ?? '', p);
        throw err;
      }
    },
    async stamp(eventId) {
      await svc(db, (tx) =>
        tx.query(
          `update public.stripe_events set processed_at = now()
            where id = $1 and handled is not null and processed_at is null`,
          [eventId],
        ),
      );
    },
  };
}

let template: Promise<PGlite> | null = null;

/** A database with every migration applied: migrated once per test file, cloned per call. */
export async function webhookTestDb(): Promise<PGlite> {
  template ??= (async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    return db;
  })();
  return (await template).clone() as Promise<PGlite>;
}

export interface DeliverOptions {
  /** The handler's clock; a minute after the event by default. */
  now?: Date;
  livemode?: boolean;
  catalog?: Catalog;
  /** In place of the fake's own sinks. */
  sinks?: EffectSinks;
}

export interface WebhookWorld {
  db: PGlite;
  stripe: StripeFake;
  hooks: PgliteHooks;
  reports: WebhookReport[];
  /** A signed-up user's personal account, bound to `customer` as the checkout route binds it. */
  account(customer: string): Promise<string>;
  deliver(event: Stripe.Event, options?: DeliverOptions): Promise<WebhookOutcome>;
}

export async function webhookWorld(): Promise<WebhookWorld> {
  const db = await webhookTestDb();
  const stripe = new StripeFake();
  const hooks: PgliteHooks = {};
  const reports: WebhookReport[] = [];
  return {
    db,
    stripe,
    hooks,
    reports,
    async account(customer) {
      const user = await db.query<{ id: string }>(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
        [`${customer}@example.com`],
      );
      const { rows } = await db.query<{ id: string }>(
        `update public.accounts set stripe_customer_id = $2
          where id = (select default_account_id from public.users where id = $1) returning id`,
        [user.rows[0]!.id, customer],
      );
      return rows[0]!.id;
    },
    deliver(event, options = {}) {
      return applyStripeEvent(
        event,
        {
          db: pgliteWebhookDb(db, hooks),
          stripe,
          catalog: options.catalog ?? fakeCatalog(),
          sinks: options.sinks ?? stripe.sinks(),
          livemode: options.livemode ?? false,
        },
        {
          now: () => options.now ?? new Date((event.created + 60) * 1000),
          report: (r) => reports.push(r),
        },
      );
    },
  };
}
