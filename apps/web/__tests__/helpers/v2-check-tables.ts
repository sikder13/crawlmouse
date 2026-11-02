import { createHash, randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';

/**
 * Shared by the CC-06 tests: the three migrations, an insert helper, a valid row for every table
 * migration 003 creates, and a two-account world with a scoped seat.
 *
 * The rows are the smallest that satisfy every constraint. A CHECK test starts from one of them and
 * breaks a single column, so a row here that violated anything would make those tests pass for the
 * wrong reason; `every builder's row inserts` in v2-003-check-tables.test.ts guards that.
 */

export const MIGRATION_003 = '20261102000001_v2_003_sites_checks.sql';
export const MIGRATION_005 = '20261102000002_v2_005_sharing_columns.sql';
export const MIGRATION_007 = '20261102000003_v2_007_storage.sql';
export const MIGRATION_001 = '20261101000001_v2_001_entitlement_tables.sql';

export function revertFile(migration: string): string {
  return migration.replace(/\.sql$/, '.revert.sql');
}

/** Migration files up to and including `migration`. */
export function through(migration: string): (file: string) => boolean {
  return (file) => file <= migration;
}

/** Migration files strictly before `migration`. */
export function before(migration: string): (file: string) => boolean {
  return (file) => file < migration;
}

type Db = PGlite | Transaction;
type Row = Record<string, unknown>;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Insert `row` into `public.<table>`. Values go through `jsonb_populate_record`, so a JSON array
 * lands in an array column, an object or array in a jsonb column, and JSON null as SQL NULL.
 */
export async function insertRow(db: Db, table: string, row: Row): Promise<void> {
  const cols = Object.keys(row).map(ident).join(', ');
  await db.query(
    `insert into public.${ident(table)} (${cols})
     select ${cols} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb)`,
    [JSON.stringify(row)],
  );
}

export async function signUp(db: Db, email: string): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return id;
}

export async function personalAccount(
  db: Db,
  userId: string,
): Promise<{ accountId: string; seatId: string }> {
  const { rows } = await db.query<{ account_id: string; seat_id: string }>(
    `select u.default_account_id as account_id, s.id as seat_id
       from public.users u join public.seats s on s.account_id = u.default_account_id and s.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  return { accountId: rows[0]!.account_id, seatId: rows[0]!.seat_id };
}

const SHA = (n: number) => n.toString(16).padStart(64, '0');
/** sha256 hex of the UTF-8 URL: what page_results.url_hash and the link_edges hashes hold. */
export const urlHash = (url: string) => createHash('sha256').update(url, 'utf8').digest('hex');
const T0 = '2026-10-20T06:00:00.000Z';
const T1 = '2026-10-20T06:05:00.000Z';
const T2 = '2026-10-20T06:20:00.000Z';

/** A valid row for every table migration 003 creates. */
export const ROWS = {
  sites: (id: string, accountId: string | null, host: string): Row => ({
    id,
    account_id: accountId,
    host,
    staging_of_site_id: null,
    client_name: null,
    client_contact_name: null,
    client_contact_email: null,
    schedule_cadence: accountId === null ? null : 'weekly',
    schedule_iso_weekday: accountId === null ? null : 1,
    schedule_hour_local: accountId === null ? null : 6,
    paused_reason: null,
    competitor_hosts: [],
    slack_channel: null,
    owner_seat_id: null,
    created_at: T0,
  }),
  checks: (id: string, siteId: string): Row => ({
    id,
    site_id: siteId,
    previous_check_id: null,
    status: 'finished',
    trigger: 'manual',
    grade_version: '2.0.0',
    queued_at: T0,
    started_at: T1,
    finished_at: T2,
    tested_at: T1,
    expires_at: null,
    deferred_until: null,
    failure_reason: null,
    result_email: null,
    coverage: { pages_discovered: 1, pages_crawled: 1 },
    technical_seo: { score: 80 },
    ai_readability: { withheld: false },
    structure: null,
    without_js: null,
    content: null,
    signals: [],
    crawlers: [],
    stack: null,
    competitors: [],
    progress: null,
  }),
  page_results: (checkId: string, url: string): Row => ({
    check_id: checkId,
    url,
    template_key: '/',
    kind: 'content',
    status_code: 200,
    depth: 0,
    links_in: 0,
    links_out: 1,
    pagerank_share: 0.5,
    is_orphan: false,
    js_only: false,
    found_via: 'link',
    sitemap_lastmod: null,
    suggested_parent_url: null,
    sampled: true,
    without_js: null,
    crawlers_reached: null,
    crawlers_reading_text: null,
    content_failures: [],
    final_url: url,
    redirect: null,
    canonical_declared: null,
    hreflang: null,
    content_simhash: null,
    is_html: true,
    links_read: true,
    robots_search: [],
  }),
  link_edges: (checkId: string, from: string, to: string): Row => ({
    check_id: checkId,
    from_url: from,
    to_url: to,
    anchor_text: 'Shop tents',
    is_generic_anchor: false,
    js_only: false,
  }),
  access_tests: (id: string, checkId: string): Row => ({
    id,
    check_id: checkId,
    ua: 'GPTBot',
    page_url: 'https://example.com/',
    template_key: '/',
    tested_at: T1,
    verdict: 'allowed',
    evidence_class: 'simulated',
    identity_sent: 'Mozilla/5.0 (compatible; GPTBot/1.2)',
    source_ip_class: 'fly_egress',
    limitations: [],
    cause: null,
    request_headers: [],
    raw_status: 200,
    final_url: null,
    headers: [],
    byte_count: 1000,
    word_count: 120,
    body_excerpt: '<html>',
  }),
  site_fixes: (id: string, siteId: string, checkId: string, n: number): Row => ({
    id,
    site_id: siteId,
    fingerprint: n.toString(16).padStart(16, '0'),
    number: n,
    type: 'orphan_pages',
    section: 'structure',
    title: 'Link to the orphan pages',
    detail: null,
    recommendation_class: 'best_practice',
    status: 'open',
    last_state: 'detected',
    last_measured_check_id: checkId,
    first_seen_check_id: checkId,
    confidence: 'confirmed',
    affected_pages: 3,
    template_key: null,
    crawler_uas: [],
    rank: 1,
    effect: { technical_seo: 2, ai_readability: 1, ai_readability_pending_on: [], estimate: true },
    effort: null,
    before_after: [],
    packet: null,
  }),
  fix_events: (id: string, fixId: string, checkId: string): Row => ({
    id,
    fix_id: fixId,
    at: T2,
    kind: 'verified',
    by_seat_id: null,
    check_id: checkId,
  }),
  changes: (id: string, siteId: string, checkId: string): Row => ({
    id,
    site_id: siteId,
    check_id: checkId,
    previous_check_id: null,
    detected_at: T2,
    kind: 'opened',
    severity: 'bad',
    subject: 'crawler_access',
    summary: 'GPTBot is now blocked',
    where: 'robots.txt',
    pages_affected: 1,
    ua: 'GPTBot',
    grade_deltas: [],
    cause: null,
    fix_id: null,
    notified: null,
  }),
  evidence_blobs: (id: string, checkId: string): Row => ({
    id,
    check_id: checkId,
    storage_path: `anon/x/${checkId}.v1.json.gz`,
    version: 1,
    bytes: 2048,
    sha256: SHA(1),
    contents: { pages: 1 },
  }),
  alert_rules: (
    id: string,
    accountId: string,
    siteId: string | null,
    kind = 'crawler_blocked',
  ): Row => ({
    id,
    account_id: accountId,
    site_id: siteId,
    kind,
    enabled: true,
    threshold_points: kind === 'text_drop' ? 10 : null,
    channels: ['email'],
    last_fired_at: null,
    last_fired_check_id: null,
  }),
  alert_events: (id: string, ruleId: string, siteId: string, checkId: string): Row => ({
    id,
    rule_id: ruleId,
    site_id: siteId,
    check_id: checkId,
    change_ids: [],
    channel: 'email',
    destination_hash: SHA(2),
    provider_message_id: null,
    status: 'sent',
    sent_at: T2,
  }),
  reports: (id: string, accountId: string, siteId: string, checkId: string): Row => ({
    id,
    account_id: accountId,
    site_id: siteId,
    kind: 'audit_pdf',
    format: 'pdf',
    status: 'ready',
    made_by: 'user',
    created_at: T2,
    covers_check_ids: [checkId],
    byte_count: 4096,
    share_expires_at: null,
    public_slug: null,
    scheduled_for: null,
    sent_at: null,
    recipient_email: null,
    owner_seat_id: null,
    headline: null,
    open_tracking: false,
    opened_at: null,
    storage_path: null,
  }),
  report_schedules: (siteId: string, accountId: string): Row => ({
    site_id: siteId,
    account_id: accountId,
    cadence: 'weekly',
    iso_weekday: 1,
    time_local: '08:00',
    timezone: 'America/Denver',
    send_when_unchanged: false,
    open_tracking: false,
    page_slug: 'client-a',
    paused_by_recipient_at: null,
  }),
  share_links: (tokenHash: string, reportId: string): Row => ({
    token_hash: tokenHash,
    report_id: reportId,
    expires_at: '2026-11-20T06:00:00.000Z',
    created_by: null,
    view_count: 0,
  }),
  api_keys: (id: string, accountId: string, keyHash: string): Row => ({
    id,
    account_id: accountId,
    name: 'CI',
    prefix: 'cm_ro_ab12cd',
    key_hash: keyHash,
    scopes: ['read:checks'],
    created_by: null,
  }),
  deploy_hooks: (id: string, siteId: string, tokenHash: string): Row => ({
    id,
    site_id: siteId,
    token_hash: tokenHash,
    provider: 'vercel',
    fire_count: 0,
  }),
  seat_sites: (seatId: string, siteId: string, accountId: string): Row => ({
    seat_id: seatId,
    site_id: siteId,
    account_id: accountId,
  }),
} as const;

export type NewTable = keyof typeof ROWS;
export const NEW_TABLES = Object.keys(ROWS).sort() as NewTable[];

/** Where a seeded row belongs: one of the account's two sites, or the account as a whole. */
export type Scope = 'site1' | 'site2' | 'account';

export interface World {
  accountId: string;
  ownerId: string;
  ownerSeatId: string;
  /** A developer seat on this account, scoped to site1 only. */
  scopedUserId: string;
  scopedSeatId: string;
  site1: string;
  site2: string;
  /** Every seeded row, by table: its primary key (as a JSON object) and its scope. */
  seeded: Record<NewTable, { pk: Row; scope: Scope }[]>;
}

let worldSerial = 0;

/**
 * One account with two sites and one row in every new table per site (and one account-level row
 * where a table has them), plus a developer seat scoped to site1. Written as postgres, which
 * bypasses RLS here as service_role does on Supabase.
 */
export async function seedWorld(db: Db, tag: string): Promise<World> {
  const n = ++worldSerial;
  const ownerId = await signUp(db, `owner-${tag}-${n}@example.com`);
  const { accountId, seatId: ownerSeatId } = await personalAccount(db, ownerId);
  const scopedUserId = await signUp(db, `dev-${tag}-${n}@example.com`);
  const scopedSeatId = randomUUID();
  await db.query(
    `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at, client_scope_all)
     values ($1, $2, $3, $4, 'developer', 'active', now(), false)`,
    [scopedSeatId, accountId, scopedUserId, `dev-${tag}-${n}@example.com`],
  );

  const seeded = Object.fromEntries(NEW_TABLES.map((t) => [t, []])) as unknown as World['seeded'];
  const put = async (table: NewTable, row: Row, pk: Row, scope: Scope) => {
    await insertRow(db, table, row);
    seeded[table].push({ pk, scope });
  };

  const site1 = randomUUID();
  const site2 = randomUUID();
  let k = n * 100;
  for (const [siteId, scope, host] of [
    [site1, 'site1', `one-${tag}-${n}.example`],
    [site2, 'site2', `two-${tag}-${n}.example`],
  ] as const) {
    await put('sites', ROWS.sites(siteId, accountId, host), { id: siteId }, scope);
    const checkId = randomUUID();
    await put('checks', ROWS.checks(checkId, siteId), { id: checkId }, scope);
    const url = `https://${host}/`;
    await insertRow(db, 'page_results', ROWS.page_results(checkId, url));
    seeded.page_results.push({ pk: { check_id: checkId, url_hash: urlHash(url) }, scope });
    await insertRow(db, 'link_edges', ROWS.link_edges(checkId, url, `${url}tents`));
    seeded.link_edges.push({
      pk: { check_id: checkId, from_hash: urlHash(url), to_hash: urlHash(`${url}tents`) },
      scope,
    });
    const at = randomUUID();
    await put('access_tests', ROWS.access_tests(at, checkId), { id: at }, scope);
    const fixId = randomUUID();
    await put('site_fixes', ROWS.site_fixes(fixId, siteId, checkId, ++k), { id: fixId }, scope);
    const ev = randomUUID();
    await put('fix_events', ROWS.fix_events(ev, fixId, checkId), { id: ev }, scope);
    const ch = randomUUID();
    await put('changes', ROWS.changes(ch, siteId, checkId), { id: ch }, scope);
    const blob = randomUUID();
    await put('evidence_blobs', ROWS.evidence_blobs(blob, checkId), { id: blob }, scope);
    const rule = randomUUID();
    await put('alert_rules', ROWS.alert_rules(rule, accountId, siteId), { id: rule }, scope);
    const ae = randomUUID();
    await put('alert_events', ROWS.alert_events(ae, rule, siteId, checkId), { id: ae }, scope);
    const rep = randomUUID();
    await put('reports', ROWS.reports(rep, accountId, siteId, checkId), { id: rep }, scope);
    await put(
      'report_schedules',
      ROWS.report_schedules(siteId, accountId),
      { site_id: siteId },
      scope,
    );
    const token = SHA(++k);
    await put('share_links', ROWS.share_links(token, rep), { token_hash: token }, scope);
    const hook = randomUUID();
    await put('deploy_hooks', ROWS.deploy_hooks(hook, siteId, SHA(++k)), { id: hook }, scope);
  }
  const accountRule = randomUUID();
  await put(
    'alert_rules',
    ROWS.alert_rules(accountRule, accountId, null),
    { id: accountRule },
    'account',
  );
  const key = randomUUID();
  await put('api_keys', ROWS.api_keys(key, accountId, SHA(++k)), { id: key }, 'account');
  await put(
    'seat_sites',
    ROWS.seat_sites(scopedSeatId, site1, accountId),
    { seat_id: scopedSeatId, site_id: site1 },
    'account',
  );

  return { accountId, ownerId, ownerSeatId, scopedUserId, scopedSeatId, site1, site2, seeded };
}

/** The catalog's constraint names and definitions on `table`, by contype. */
export async function constraints(
  db: Db,
  table: string,
  contype: 'c' | 'f' | 'u' | 'p' = 'c',
): Promise<{ name: string; def: string; columns: string[] }[]> {
  const { rows } = await db.query<{ name: string; def: string; columns: string[] }>(
    `select k.conname as name, pg_get_constraintdef(k.oid) as def,
            array(select a.attname::text from unnest(k.conkey) c(n)
                    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = c.n order by 1) as columns
       from pg_constraint k join pg_class r on r.oid = k.conrelid
       join pg_namespace s on s.oid = r.relnamespace
      where s.nspname = 'public' and r.relname = $1 and k.contype = $2
      order by k.conname`,
    [table, contype],
  );
  return rows;
}

/**
 * The value set of an enum CHECK on one column: `col = ANY (ARRAY['a'::text, ...])`, or for an
 * array column `col <@ ARRAY['a'::text, ...]`. Null when the definition is anything else.
 */
export function enumSetOf(def: string): string[] | null {
  // `col in ('a', 'b')` is stored as `= ANY (ARRAY[…])`; a one-value `in ('a')` as `= 'a'::text`.
  const m =
    /^CHECK \(\(?"?\w+"? (?:= ANY \(ARRAY\[(.*)\]\)|<@ ARRAY\[(.*)\]|= ('[^']*'::text))\)\)?$/.exec(
      def,
    );
  if (!m) return null;
  const body = m[1] ?? m[2] ?? m[3] ?? '';
  return [...body.matchAll(/'([^']*)'::text/g)].map((x) => x[1]!).sort();
}
