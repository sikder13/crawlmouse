import { QA_ACCOUNTS, type QaAccount, type QaKey } from './accounts';
import { qaAddress } from './inbox';

/**
 * `pnpm qa:seed` part (a) (CC-38 D1): the QA account set made through the paths a customer goes
 * through — a user made by Supabase Auth's admin API, so `handle_new_user` gives it its account; an
 * agency account from CC-29's `start_agency_trial_account`; sites from `add_site`; the developer's
 * seat by invitation and acceptance; the no-card Pro trial from the account door's own decision.
 * Marked internal through CC-33's `ops:internal` module. It never writes a plan.
 *
 * Every step is looked up before it is done, so a second run does nothing and says so. A step the
 * account cannot take yet (no room on its plan, the trial refused) is refused with its reason, and
 * the run goes on; the exit is non-zero when any step was refused for a reason other than the plan.
 *
 * `only: 'sites-and-seats'` is qa:reset's second half (./reset.ts): on accounts it has checked are
 * the set's (the user carries the key, the account its marker and `internal`), it puts the sites and
 * the developer's seat back, and it creates nothing else.
 */

export type Outcome = 'done' | 'unchanged' | 'refused' | 'waits_for_plan';

/** A QA account's key, or `run` for a step about the whole run (billing's mode check, the coupon). */
export type StepKey = QaKey | 'run';

export interface Step {
  key: StepKey;
  step: string;
  outcome: Outcome;
  detail?: string;
}

export interface Seat {
  accountId: string;
  ownerSeatId: string;
}

/** The user Supabase Auth has at an address, with the set key the seed stamped on it, if any. */
export interface AuthUser {
  id: string;
  qaKey: string | null;
}

export interface QaAuth {
  find(email: string): Promise<AuthUser | null>;
  /** A confirmed user with `app_metadata.qa_seed = key`; its id. */
  create(email: string, key: QaKey): Promise<string>;
}

/** add_site's answer, with the time a capped add fits again (`unsent`: see `QaStore.addSite`). */
export type AddResult =
  | { outcome: 'created'; unsent?: string }
  | { outcome: 'exists' | 'full' | 'capacity' | 'paused' }
  | { outcome: 'adds_capped' | 'domain_capped'; nextAllowedAt: string };
/** The door's first-audit answer (lib/v2/pipeline/first-audit.ts), or `no_site`. */
export type FirstAuditResult =
  | { outcome: 'requested'; unsent?: string }
  | { outcome: 'has_check' | 'capacity' | 'domain_limit' | 'paused' | 'no_site' };
export type TrialResult =
  | { outcome: 'started' | 'not_eligible' }
  | { outcome: 'refused'; reason: string };
export type SeatResult = 'accepted' | 'already_member' | 'full' | 'refused';

export interface QaStore {
  /** CRAWL_PAUSED where the script runs (`isCrawlPaused`). */
  paused(): boolean;
  /** The user's own account and their owner seat on it (handle_new_user's). */
  personal(userId: string): Promise<Seat | null>;
  /** An agency account the user owns, of this name; null when there is none. */
  agency(userId: string, name: string): Promise<Seat | null>;
  /** CC-29's second account, with its first site. */
  startAgency(userId: string, name: string, firstHost: string): Promise<Seat>;
  /** The set key D2's table holds for the account, or null. */
  marker(accountId: string): Promise<string | null>;
  addMarker(accountId: string, key: QaKey): Promise<void>;
  isInternal(accountId: string): Promise<boolean>;
  hosts(accountId: string): Promise<string[]>;
  /** `unsent`: the site was added, and its first audit's event was not sent (the message why). */
  addSite(seat: Seat, host: string, userId: string): Promise<AddResult>;
  /**
   * The first audit of the account's site at `host`, through the door's requester, and the schedule
   * add_site would have stored with it: for the first site `start_agency_trial_account` stores with
   * neither, so a fresh seed and qa:reset leave the same checks and schedules (questions Q15).
   */
  firstAudit(seat: Seat, host: string, userId: string): Promise<FirstAuditResult>;
  /** Invites `email` as a developer scoped to the account's first client, then accepts as `userId`. */
  developerSeat(seat: Seat, email: string, userId: string): Promise<SeatResult>;
  memberRole(accountId: string, userId: string): Promise<string | null>;
  proTrial(seat: Seat, userId: string, email: string): Promise<TrialResult>;
}

export interface SeedDeps {
  auth: QaAuth;
  store: QaStore;
  /** CC-33's `ops:internal` (scripts/ops/internal.ts `runInternal`). */
  markInternal(accountId: string): Promise<void>;
  inbox: { local: string; domain: string };
  /** Asks the operator, and answers what they typed. */
  confirm(prompt: string): Promise<string>;
  print(line: string): void;
}

export interface SeedOptions {
  /**
   * `sites-and-seats`: qa:reset's second half. Nothing is created but sites and the developer's seat;
   * a user, account, marker or internal flag that is missing is refused instead of made, and the
   * trial is left alone.
   */
  only?: 'sites-and-seats';
}

export class Refused extends Error {}

/** Records a step and prints it, in the seed's one format. */
export function noter(
  steps: Step[],
  print: (line: string) => void,
  key: StepKey,
): (step: string, outcome: Outcome, detail?: string) => void {
  return (step, outcome, detail) => {
    steps.push({ key, step, outcome, ...(detail ? { detail } : {}) });
    print(`${key.padEnd(12)} ${step.padEnd(14)} ${outcome}${detail ? `: ${detail}` : ''}`);
  };
}

/** What the operator types before qa:seed creates users. */
export const createPhrase = (n: number, domain: string): string => `create ${n} users at ${domain}`;

export async function seed(deps: SeedDeps, opts: SeedOptions = {}): Promise<Step[]> {
  const restore = opts.only === 'sites-and-seats';
  const steps: Step[] = [];
  // A mistyped QA_INBOX would make confirmed users at someone else's domain: the addresses are
  // printed and confirmed first. The restore creates no user, so it asks nothing.
  if (!restore && !(await confirmNewUsers(deps))) {
    noter(steps, deps.print, 'run')('stopped', 'refused', 'the confirmation was not typed');
    return steps;
  }
  const homes = new Map<QaKey, Seat>();
  for (const account of QA_ACCOUNTS) {
    const note = noter(steps, deps.print, account.key);
    try {
      await seedOne({ deps, note, restore }, account, homes);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      note('stopped', 'refused', e.message);
    }
  }
  return steps;
}

/** Prints the users a run would create and asks for the phrase; true when there are none. */
async function confirmNewUsers(deps: SeedDeps): Promise<boolean> {
  const missing: string[] = [];
  for (const a of QA_ACCOUNTS) {
    const email = qaAddress(deps.inbox, a.key);
    if ((await deps.auth.find(email)) === null) missing.push(email);
  }
  if (missing.length === 0) return true;
  deps.print(`qa:seed will create ${missing.length} confirmed users:`);
  for (const email of missing) deps.print(`  ${email}`);
  const phrase = createPhrase(missing.length, deps.inbox.domain);
  return (await deps.confirm(`Type "${phrase}" to go on: `)) === phrase;
}

export type Note = (step: string, outcome: Outcome, detail?: string) => void;

/** What every step reads: the ports, the step recorder, and whether this is qa:reset's restore. */
interface Run {
  deps: SeedDeps;
  note: Note;
  restore: boolean;
}

async function seedOne(run: Run, account: QaAccount, homes: Map<QaKey, Seat>): Promise<void> {
  const { deps, note } = run;
  const email = qaAddress(deps.inbox, account.key);
  const userId = await user(run, account.key, email);
  const home = account.home;

  if (home.kind === 'seat') {
    // The developer's own account is ours too, as an agency user's is: marked and internal.
    const own = await personalOf(deps, userId);
    await internal(run, own.accountId, await mark(run, account.key, own.accountId));
    const on = homes.get(home.on);
    if (!on) throw new Refused(`${home.on} was not seeded in this run, so no seat is put on it`);
    if ((await deps.store.memberRole(on.accountId, userId)) !== null) {
      note('seat', 'unchanged');
      return;
    }
    const r = await deps.store.developerSeat(on, email, userId);
    if (r === 'accepted') note('seat', 'done', `developer on ${home.on}, its first client`);
    else if (r === 'full') note('seat', 'waits_for_plan', `${home.on} has no free seat`);
    else note('seat', 'refused', r);
    return;
  }

  const { seat, markedNow } = await accountOf(run, account, userId);
  await internal(run, seat.accountId, markedNow);
  // Only an account that passed every check above is one a seat may be put on.
  homes.set(account.key, seat);
  const firstHeld = await sites(run, account, seat, userId);
  if (home.kind === 'agency' && firstHeld) await firstAudit(run, account, seat, userId);
  if (account.proTrial && !run.restore) {
    const t = await deps.store.proTrial(seat, userId, email);
    if (t.outcome === 'refused') note('pro trial', 'refused', t.reason);
    else if (t.outcome === 'started') note('pro trial', 'done');
    else note('pro trial', 'unchanged', 'not Free, or used');
  }
}

async function user({ deps, note, restore }: Run, key: QaKey, email: string): Promise<string> {
  const found = await deps.auth.find(email);
  if (found === null) {
    if (restore) throw new Refused(`${email} has no user: run qa:seed first`);
    const id = await deps.auth.create(email, key);
    note('user', 'done');
    return id;
  }
  if (found.qaKey !== key) {
    throw new Refused(`${email} exists and was not made by qa:seed; it is left alone`);
  }
  note('user', 'unchanged');
  return found.id;
}

async function personalOf(deps: SeedDeps, userId: string): Promise<Seat> {
  const seat = await deps.store.personal(userId);
  if (seat === null) throw new Refused('the user has no account: handle_new_user did not run');
  return seat;
}

/** The account the key's work lives on, and whether this run wrote its marker. */
async function accountOf(
  run: Run,
  account: QaAccount,
  userId: string,
): Promise<{ seat: Seat; markedNow: boolean }> {
  const { deps, note } = run;
  const home = account.home;
  if (home.kind === 'personal') {
    const seat = await personalOf(deps, userId);
    return { seat, markedNow: await mark(run, account.key, seat.accountId) };
  }
  if (home.kind !== 'agency') throw new Error('unreachable');
  // The agency user's own account is ours too: marked and internal, so nothing they do counts.
  const own = await personalOf(deps, userId);
  await internal(run, own.accountId, await mark(run, account.key, own.accountId));
  const first = account.sites[0];
  if (!first) throw new Error(`${account.key} has no first site`);
  const existing = await deps.store.agency(userId, home.name);
  if (existing !== null) {
    // An agency account holding only its first QA site is the one start_agency_trial_account made
    // for this user: a run stopped before its marker was written adopts it on the next run.
    const markedNow = await mark(run, account.key, existing.accountId, { firstHost: first });
    return { seat: existing, markedNow };
  }
  if (run.restore) throw new Refused(`no agency account ${home.name}: run qa:seed first`);
  const seat = await deps.store.startAgency(userId, home.name, first);
  note('agency', 'done', home.name);
  return { seat, markedNow: await mark(run, account.key, seat.accountId, { made: true }) };
}

/**
 * D2's marker: written once, for an account this run made or one whose user this seed made and that
 * holds nothing the seed did not add. True when this run wrote it.
 */
async function mark(
  { deps, note, restore }: Run,
  key: QaKey,
  accountId: string,
  how: { made?: boolean; firstHost?: string } = {},
): Promise<boolean> {
  const held = await deps.store.marker(accountId);
  if (held === key) {
    note('marker', 'unchanged');
    return false;
  }
  if (held !== null) throw new Refused(`the account is marked for ${held}`);
  if (restore) throw new Refused('the account has no qa_accounts row; it is left alone');
  if (!how.made && !(await isFresh(deps, accountId, how.firstHost))) {
    throw new Refused('the account holds sites the seed did not add; it is left alone');
  }
  await deps.store.addMarker(accountId, key);
  note('marker', 'done');
  return true;
}

/**
 * An account with no site yet (the one handle_new_user just gave a user this seed made), or, given
 * `firstHost`, an agency account whose one live site is that host.
 */
async function isFresh(deps: SeedDeps, accountId: string, firstHost?: string): Promise<boolean> {
  const held = await deps.store.hosts(accountId);
  return (
    held.length === 0 || (firstHost !== undefined && held.length === 1 && held[0] === firstHost)
  );
}

/**
 * `accounts.internal`, set through ops:internal only for an account this run marked. An account
 * marked earlier whose flag is false had it turned off by someone (D1): it is refused, not set again.
 */
async function internal(
  { deps, note, restore }: Run,
  accountId: string,
  markedNow: boolean,
): Promise<void> {
  if (await deps.store.isInternal(accountId)) {
    note('internal', 'unchanged');
    return;
  }
  if (restore || !markedNow) {
    throw new Refused(
      `accounts.internal is false; it is left alone (pnpm ops:internal ${accountId} sets it)`,
    );
  }
  await deps.markInternal(accountId);
  if (!(await deps.store.isInternal(accountId))) {
    throw new Refused('ops:internal answered, but accounts.internal is still false');
  }
  note('internal', 'done');
}

/** Why add_site or the first audit was refused, as the operator reads it. */
function capped(r: { outcome: string; nextAllowedAt?: string }): string {
  switch (r.outcome) {
    case 'domain_capped':
    case 'domain_limit':
      return `the host's hourly first-audit bound is reached${r.nextAllowedAt ? `; run again after ${r.nextAllowedAt}` : '; run again in an hour'}`;
    case 'adds_capped':
      return `the account's daily bound on added sites is reached; run again after ${r.nextAllowedAt}`;
    case 'capacity':
      return "the platform's daily check ceiling is reached; run again tomorrow";
    case 'paused':
      return 'crawls are paused (CRAWL_PAUSED)';
    default:
      return r.outcome;
  }
}

/**
 * The account's sites, in the set's order; whether it holds its first one afterwards. An add refused
 * by a bound stops the account's list there: the next host would otherwise take the free slot, and
 * the account's first site would change from one run to the next.
 */
async function sites(
  { deps, note }: Run,
  account: QaAccount,
  seat: Seat,
  userId: string,
): Promise<boolean> {
  const have = new Set(await deps.store.hosts(seat.accountId));
  const first = account.sites[0];
  for (const host of account.sites) {
    // add_site answers `exists` for a held host too; looking first skips its SSRF lookup.
    if (have.has(host)) {
      note(`site`, 'unchanged', host);
      continue;
    }
    const r = await deps.store.addSite(seat, host, userId);
    if (r.outcome === 'created' || r.outcome === 'exists') have.add(host);
    if (r.outcome === 'created' && r.unsent !== undefined) {
      note(
        'site',
        'done',
        `${host}; its first audit was not sent (${r.unsent}), so it stays queued`,
      );
    } else if (r.outcome === 'created' || r.outcome === 'exists')
      note('site', r.outcome === 'created' ? 'done' : 'unchanged', host);
    else if (r.outcome === 'full')
      note('site', 'waits_for_plan', `${host}: no room on the current plan`);
    else {
      note(
        'site',
        'refused',
        `${host}: ${capped(r)}; the account's other sites wait for the next run`,
      );
      break;
    }
  }
  return first !== undefined && have.has(first);
}

/** An agency account's first site has its first audit, as a site add_site stores does. */
async function firstAudit(
  { deps, note }: Run,
  account: QaAccount,
  seat: Seat,
  userId: string,
): Promise<void> {
  const host = account.sites[0]!;
  const r = await deps.store.firstAudit(seat, host, userId);
  if (r.outcome === 'requested' && r.unsent !== undefined) {
    note('first audit', 'done', `${host}; not sent (${r.unsent}), so it stays queued`);
  } else if (r.outcome === 'requested') note('first audit', 'done', host);
  else if (r.outcome === 'has_check') note('first audit', 'unchanged', host);
  else if (r.outcome === 'no_site') note('first audit', 'refused', `${host}: the site is missing`);
  else note('first audit', 'refused', `${host}: ${capped(r)}`);
}

/** Non-zero when a step was refused; a step that waits for the plan is expected before --billing. */
export function exitCode(steps: readonly Pick<Step, 'outcome'>[]): number {
  return steps.some((s) => s.outcome === 'refused') ? 1 : 0;
}
