/**
 * What the support console's two actions share (CC-33 D2): the reason field, and the notice each
 * sends the account page back with. Only the code goes into the address (`?done=<code>`), and the
 * page shows its one line from `DONE_LINES`.
 */

/** The longest reason kept, after trimming. */
export const REASON_MAX = 500;

/**
 * The reason, trimmed, when it is a string of 1 to 500 characters with no `@`: the record outlives
 * the account it names, so it holds no address (`operator_actions_reason_check` refuses one too).
 */
export function readReason(fields: Readonly<Record<string, unknown>>): string | null {
  const raw = fields.reason;
  if (typeof raw !== 'string') return null;
  const reason = raw.trim();
  if (reason.length < 1 || reason.length > REASON_MAX || reason.includes('@')) return null;
  return reason;
}

export const DONE_CODES = [
  'rerun_queued',
  'rerun_exists',
  'capped',
  'check_running',
  'recently_checked',
  'capacity',
  'paused',
  'unavailable',
  'not_failed',
  'site_removed',
  'site_paused',
  'reason_invalid',
  'link_sent',
  'link_refused',
  'rate_limited',
] as const;

export type DoneCode = (typeof DONE_CODES)[number];

export const DONE_LINES: Record<DoneCode, string> = {
  rerun_queued: 'Re-run queued. It is in the checks list below.',
  rerun_exists: 'A re-run of this site is already queued; it was not queued twice.',
  capped: "Not re-run: the site has used today's manual checks for its plan.",
  check_running: 'Not re-run: a check of this site is running now.',
  recently_checked: 'Not re-run: this site was checked moments ago. Try again in two minutes.',
  capacity: "Not re-run: today's platform-wide check ceiling is reached.",
  paused: 'Not re-run: crawls are paused (CRAWL_PAUSED).',
  unavailable: 'Not re-run: the pipeline is off (V2_PIPELINE).',
  not_failed: 'Not re-run: only a failed check can be re-run.',
  site_removed: 'Not re-run: the site was removed.',
  site_paused: 'Not re-run: the site is paused.',
  reason_invalid:
    'Nothing done: a reason of 1 to 500 characters, with no email address, is required.',
  link_sent: 'Sign-in link requested. Supabase Auth sends it to the seat’s address.',
  link_refused: 'Supabase Auth refused the sign-in link. Nothing was sent.',
  rate_limited: 'Not sent: this address has had its sign-in links for the hour.',
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN: ReadonlySet<string> = new Set(DONE_CODES);

/** A 303 to the account page with the notice's code. */
export function doneTo(accountId: string, code: DoneCode): Response {
  if (!ID.test(accountId)) throw new Error('doneTo: not an account id');
  return new Response(null, {
    status: 303,
    headers: { location: `/internal/accounts/${accountId}?done=${code}` },
  });
}

/** The page's `done` search param, read back: null unless it is one of ours. */
export function doneOf(
  params: Readonly<Record<string, string | string[] | undefined>>,
): DoneCode | null {
  const code = params.done;
  return typeof code === 'string' && KNOWN.has(code) ? (code as DoneCode) : null;
}
