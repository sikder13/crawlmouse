import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import {
  aiReadabilityStatus,
  ENTITIES,
  technicalSeoStatus,
  verdictStatus,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { insertRow, premakeTestMonths, signUp } from './helpers/v2-check-tables';
import { NOT_STORED_YET, VALUES_NOT_STORED_YET } from './helpers/v2-contract-storage';
import { CHECK_PIPELINE_COLUMNS, SITE_SCHEDULE_COLUMNS } from '../lib/v2/pipeline/columns';

/**
 * The contract's own fixture datasets (apps/web/lib/fixtures/v2) round-trip through the tables:
 * every record of every collection this step stores is written, read back in the contract's shape,
 * parsed by the entity's schema and compared with the original. A field the tables cannot hold, or a
 * CHECK stricter than the contract, fails here on real data. Column types are not proven here: the
 * fixtures' numbers are short decimals that a narrower type also returns unchanged, so numeric types
 * are checked against the contract in v2-contract-guard.test.ts.
 *
 * Accounts are CC-01's table; they are written only so the rows that reference them can be, and
 * are not compared. Timestamps are compared as instants (the contract allows any precision).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(HERE, '../lib/fixtures/v2');
const FILES = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

type Rec = Record<string, unknown>;

const TIER: Record<string, string> = {
  free: 'free',
  pro_trial: 'pro',
  pro: 'pro',
  agency_trial: 'agency',
  agency: 'agency',
};

/** An accounts row for a fixture Account that satisfies 001's CHECKs. Not compared. */
function accountRow(a: Rec, i: number): Rec {
  const history = a.state_history as { state: string; since: string }[];
  const state = a.state as string;
  const pastDueTier = state === 'past_due' ? TIER[history[history.length - 2]!.state] : null;
  const tier = state === 'past_due' ? pastDueTier : TIER[state];
  const limits = a.limits as Rec;
  return {
    id: a.id,
    kind: tier === 'agency' ? 'agency' : 'personal',
    name: a.name,
    state,
    tier,
    past_due_tier: pastDueTier,
    past_due_since: state === 'past_due' ? history[history.length - 1]!.since : null,
    trial_variant: state === 'pro_trial' ? 'no_card' : null,
    trial_ends_at: a.trial_ends_at,
    trial_used_at: state.endsWith('_trial') ? history[history.length - 1]!.since : null,
    current_subscription_id: state === 'free' || state === 'pro_trial' ? null : `sub_fixture_${i}`,
    timezone: a.timezone,
    seat_limit: limits.seats,
    site_limit: limits.sites,
    competitor_limit: limits.competitors_per_site,
    card_last4: a.card_last4,
    state_history: history,
  };
}

/** Rows in an order their references allow: a row after the row its `ref` field names. */
function parentsFirst(rows: Rec[], ref: string): Rec[] {
  const ids = new Set(rows.map((r) => r.id));
  const done = new Set<unknown>();
  const out: Rec[] = [];
  while (out.length < rows.length) {
    const before = out.length;
    for (const r of rows) {
      if (done.has(r.id)) continue;
      if (r[ref] === null || !ids.has(r[ref]) || done.has(r[ref])) {
        out.push(r);
        done.add(r.id);
      }
    }
    if (out.length === before) throw new Error(`a cycle in ${ref}`);
  }
  return out;
}

const omit = (r: Rec, keys: string[]) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));

/**
 * Contract fields no column holds yet (helpers/v2-contract-storage.ts, NOT_STORED_YET), by fixture
 * collection: not written, so compared on what is stored. A row holding a value no CHECK accepts yet
 * (VALUES_NOT_STORED_YET) cannot be written at all; the test names those rows and compares the rest.
 */
const TABLE_OF_COLLECTION: Record<string, string> = {
  page_results: 'page_results',
  access_tests: 'access_tests',
  fixes: 'site_fixes',
};
const deferred = (collection: string): string[] => {
  const entity = ENTITIES.find((e) => e.collection === collection)?.name;
  return Object.keys(NOT_STORED_YET)
    .filter((at) => at.startsWith(`${entity}.`))
    .map((at) => at.slice(`${entity}.`.length));
};
const pending = (collection: string, r: Rec): boolean =>
  Object.entries(VALUES_NOT_STORED_YET).some(([at, values]) => {
    const [table, column] = at.split('.') as [string, string];
    return TABLE_OF_COLLECTION[collection] === table && values.includes(r[column] as string);
  });
/**
 * `pending`, and the rows that name a fix `pending` keeps out: a change or a fix event names its fix
 * by a foreign key, so it cannot be written without it (built-site's content fixes, CC-20a).
 */
const pendingIn = (d: FixtureDataset) => {
  const unwritten = new Set(
    (d.fixes as Rec[]).filter((f) => pending('fixes', f)).map((f) => String(f.id)),
  );
  return (collection: string, r: Rec): boolean =>
    pending(collection, r) ||
    ((collection === 'changes' || collection === 'fix_events') &&
      r.fix_id != null &&
      unwritten.has(String(r.fix_id)));
};
const storable = (collection: string, rows: Rec[], isPending = pending): Rec[] =>
  rows.filter((r) => !isPending(collection, r)).map((r) => omit(r, deferred(collection)));

/**
 * Database-only columns (06b), by table: not contract fields, so not in the fixtures. The loader
 * writes the fixture's lineages into them and the vantage the worker sends, and the projection drops
 * them, with the generated statuses, which are compared with the contract's functions on their own.
 */
const DATABASE_ONLY: Record<string, string[]> = {
  checks: [
    'lineage_id',
    'check_month',
    'technical_seo_status',
    'ai_readability_status',
    ...CHECK_PIPELINE_COLUMNS,
    // 022b: the notify address and the accounts a Keep copied for.
    'notify_email',
    'copied_for',
  ],
  page_results: [
    'url_hash',
    'check_month',
    'lineage_id',
    'identity_sent',
    'source_ip_class',
    'request_headers',
    'headers',
  ],
  link_edges: ['from_hash', 'to_hash', 'check_month', 'lineage_id'],
  access_tests: ['check_month', 'lineage_id', 'measurement_status'],
};
const CRAWL_UA = 'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';

async function load(db: PGlite, d: FixtureDataset): Promise<void> {
  await premakeTestMonths(db);
  for (const l of d.lineages) await insertRow(db, 'measurement_lineages', l);
  // A fixture's grading lineage has no worker; its fetching lineage has one.
  const grading = d.lineages.find((l) => l.worker_release === null)?.id;
  const fetching = d.lineages.find((l) => l.worker_release !== null)?.id;
  for (const [i, a] of d.accounts.entries())
    await insertRow(db, 'accounts', accountRow(a as Rec, i));
  for (const s of d.seats) {
    const userId = s.accepted_at ? await signUp(db, `fixture-${s.id}@example.com`) : null;
    await insertRow(db, 'seats', {
      id: s.id,
      account_id: s.account_id,
      user_id: userId,
      invited_email: s.email,
      name: s.name,
      role: s.role,
      status: s.accepted_at ? 'active' : 'invited',
      alert_channels: s.alert_channels,
      theme: s.theme,
      created_at: s.invited_at,
      accepted_at: s.accepted_at,
      client_scope_all: s.client_scope === 'all',
    });
  }
  for (const s of parentsFirst(d.sites as Rec[], 'staging_of_site_id')) {
    const sch = s.schedule as Rec | null;
    await insertRow(db, 'sites', {
      ...omit(s, ['schedule', 'client_report', 'paused']),
      schedule_cadence: sch?.cadence ?? null,
      schedule_iso_weekday: sch?.iso_weekday ?? null,
      schedule_hour_local: sch?.hour_local ?? null,
      // The contract records only that a site is paused; the fixture's reason is the trial rule.
      paused_reason: s.paused ? 'trial_ended' : null,
    });
    if (s.client_report) {
      await insertRow(db, 'report_schedules', {
        ...(s.client_report as Rec),
        site_id: s.id,
        account_id: s.account_id,
      });
    }
  }
  for (const s of d.seats) {
    if (s.client_scope === 'all') continue;
    for (const site of s.client_scope)
      await insertRow(db, 'seat_sites', { seat_id: s.id, site_id: site, account_id: s.account_id });
  }
  for (const c of parentsFirst(d.checks as Rec[], 'previous_check_id'))
    await insertRow(db, 'checks', {
      ...c,
      lineage_id: c.status === 'finished' || c.status === 'partial' ? grading : null,
    });
  // The partition key is database only: the month the row's check was queued.
  const { rows: months } = await db.query<{ id: string; month: string }>(
    `select id::text, check_month::text as month from public.checks`,
  );
  const monthOf = new Map(months.map((m) => [m.id, m.month]));
  const measured = (r: Rec) => ({
    ...r,
    check_month: monthOf.get(r.check_id as string),
    lineage_id: fetching,
  });
  for (const r of storable('page_results', d.page_results as Rec[]))
    await insertRow(db, 'page_results', {
      ...measured(r),
      identity_sent: CRAWL_UA,
      source_ip_class: 'fly_egress',
      request_headers: [{ name: 'User-Agent', value: CRAWL_UA }],
      headers: [],
    });
  for (const r of d.link_edges) await insertRow(db, 'link_edges', measured(r));
  for (const r of storable('access_tests', d.access_tests as Rec[]))
    await insertRow(db, 'access_tests', measured(r));
  for (const r of storable('fixes', d.fixes as Rec[])) await insertRow(db, 'site_fixes', r);
  const blocked = pendingIn(d);
  for (const r of storable('fix_events', d.fix_events as Rec[], blocked))
    await insertRow(db, 'fix_events', r);
  for (const r of storable('changes', d.changes as Rec[], blocked))
    await insertRow(db, 'changes', r);
  // The entitlement trigger reads now(); a fixture's plan is as of its own date, so the trigger
  // is not what this test is about. It is tested on its own in v2-003-check-tables.test.ts.
  await db.exec('alter table public.alert_rules disable trigger alert_rules_entitlement_check');
  for (const r of d.alert_rules) await insertRow(db, 'alert_rules', r);
  await db.exec('alter table public.alert_rules enable trigger alert_rules_entitlement_check');
  for (const r of d.reports) await insertRow(db, 'reports', r);
  for (const u of d.usage_events)
    await insertRow(db, 'usage_events', { ...u, idempotency_key: `fixture:${u.id}` });
}

/** A timestamptz column comes back as `…+00:00`; the contract writes instants with a trailing Z. */
function zulu(v: unknown): unknown {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+\+00:00$/.test(v))
    return new Date(v).toISOString();
  return v;
}

async function rowsOf(db: PGlite, table: string): Promise<Rec[]> {
  const { rows } = await db.query<{ r: Rec }>(`select to_jsonb(t) as r from public.${table} t`);
  return rows.map((x) => Object.fromEntries(Object.entries(x.r).map(([k, v]) => [k, zulu(v)])));
}

/** Every table row back in the contract's shape, by fixture collection. */
async function project(db: PGlite): Promise<Record<string, Rec[]>> {
  const schedules = new Map((await rowsOf(db, 'report_schedules')).map((r) => [r.site_id, r]));
  const scopes = new Map<unknown, unknown[]>();
  for (const r of await rowsOf(db, 'seat_sites'))
    scopes.set(r.seat_id, [...(scopes.get(r.seat_id) ?? []), r.site_id]);
  const dropNulls = (r: Rec) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null));
  return {
    seats: (await rowsOf(db, 'seats'))
      // The seats handle_new_user made for the fixture's users are not fixture records.
      .filter((s) => !String(s.invited_email).startsWith('fixture-'))
      .map((s) => ({
        id: s.id,
        account_id: s.account_id,
        email: s.invited_email,
        name: s.name,
        role: s.role,
        client_scope: s.client_scope_all ? 'all' : scopes.get(s.id),
        alert_channels: s.alert_channels,
        theme: s.theme,
        invited_at: s.created_at,
        accepted_at: s.accepted_at,
      })),
    sites: (await rowsOf(db, 'sites')).map((s) => {
      const cr = schedules.get(s.id);
      return {
        ...omit(s, [
          'schedule_cadence',
          'schedule_iso_weekday',
          'schedule_hour_local',
          'paused_reason',
          'removed_at',
          'updated_at',
          ...SITE_SCHEDULE_COLUMNS,
        ]),
        schedule:
          s.schedule_cadence === null
            ? null
            : {
                cadence: s.schedule_cadence,
                iso_weekday: s.schedule_iso_weekday,
                hour_local: s.schedule_hour_local,
              },
        client_report: cr
          ? omit(cr, [
              'site_id',
              'account_id',
              'next_run_at',
              'last_run_at',
              'created_at',
              'updated_at',
            ])
          : null,
      };
    }),
    checks: (await rowsOf(db, 'checks')).map((r) => omit(r, DATABASE_ONLY.checks!)),
    page_results: (await rowsOf(db, 'page_results')).map((r) =>
      omit(r, DATABASE_ONLY.page_results!),
    ),
    link_edges: (await rowsOf(db, 'link_edges')).map((r) => omit(r, DATABASE_ONLY.link_edges!)),
    access_tests: (await rowsOf(db, 'access_tests')).map((r) =>
      omit(r, DATABASE_ONLY.access_tests!),
    ),
    fixes: await rowsOf(db, 'site_fixes'),
    // A FixEvent carries only its kind's fields; the table holds the union of them.
    fix_events: (await rowsOf(db, 'fix_events')).map((r) =>
      r.kind === 'marked_done' ? omit(r, ['check_id']) : omit(dropNulls(r), ['by_seat_id']),
    ),
    changes: await rowsOf(db, 'changes'),
    alert_rules: await rowsOf(db, 'alert_rules'),
    reports: (await rowsOf(db, 'reports')).map((r) => omit(r, ['storage_path'])),
    lineages: await rowsOf(db, 'measurement_lineages'),
    usage_events: (await rowsOf(db, 'usage_events')).map((r) =>
      omit(r, ['api_key_id', 'idempotency_key']),
    ),
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Timestamps as instants; everything else as is. Applied to both sides. */
function normalize(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return Date.parse(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}

const byId = (rows: Rec[], key: (r: Rec) => string) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));
const KEY: Record<string, (r: Rec) => string> = {
  page_results: (r) => `${r.check_id} ${r.url}`,
  link_edges: (r) => `${r.check_id} ${r.from_url} ${r.to_url}`,
};

const SCHEMA_OF = Object.fromEntries(
  ENTITIES.filter((e) => e.collection).map((e) => [e.collection!, e.schema]),
);
const COLLECTIONS = [
  'seats',
  'sites',
  'checks',
  'page_results',
  'link_edges',
  'access_tests',
  'fixes',
  'fix_events',
  'changes',
  'alert_rules',
  'reports',
  'lineages',
  'usage_events',
] as const;

describe.each(FILES)('fixture %s round-trips through the tables', (file) => {
  const dataset = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as FixtureDataset;

  it('every record is written, read back, parses, and equals the original', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`set timezone = 'UTC'`);
    await load(db, dataset);
    const back = await project(db);
    const blocked = pendingIn(dataset);
    for (const c of COLLECTIONS) {
      const key = KEY[c] ?? ((r: Rec) => String(r.id));
      const all = dataset[c] as Rec[];
      const original = byId(storable(c, all, blocked), key);
      const stored = byId(back[c]!, key);
      // What a deferred field holds comes only from the fixture: no column holds it yet.
      const full = new Map(all.map((r) => [key(r), r]));
      for (const r of stored) {
        const whole = {
          ...r,
          ...Object.fromEntries(deferred(c).map((f) => [f, full.get(key(r))![f]])),
        };
        const parsed = (
          SCHEMA_OF[c] as unknown as {
            safeParse(x: unknown): { success: boolean; error?: unknown };
          }
        ).safeParse(JSON.parse(JSON.stringify(whole)));
        expect(
          parsed.success,
          `${c} ${key(r)} does not parse: ${JSON.stringify(parsed.error)}`,
        ).toBe(true);
      }
      expect(normalize(stored), `${file}: ${c}`).toEqual(normalize(original));
      // Only the rows a pending value keeps out are missing: each holds one, or names a fix that does.
      expect(all.length - stored.length).toBe(all.filter((r) => blocked(c, r)).length);
    }
    // The generated statuses, on real data, are what the contract's functions give.
    const statuses = await rowsOf(db, 'checks');
    for (const c of dataset.checks) {
      const s = statuses.find((r) => r.id === c.id)!;
      expect(s.technical_seo_status, c.id).toBe(technicalSeoStatus(c));
      expect(s.ai_readability_status, c.id).toBe(aiReadabilityStatus(c));
    }
    const tests = await rowsOf(db, 'access_tests');
    for (const t of dataset.access_tests.filter((x) => !pending('access_tests', x as Rec)))
      expect(tests.find((r) => r.id === t.id)!.measurement_status, t.id).toBe(
        verdictStatus(t.verdict),
      );
  }, 120_000);
});
