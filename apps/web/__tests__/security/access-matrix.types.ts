/**
 * The shape of the access matrix (CC-37 D1). One row for each route handler, each server entry file
 * that reads data, and each file that opens a service-role client. access-matrix.test.ts holds the
 * rows to the disk and to the code; access-matrix.render.ts writes docs/ops/access-matrix.md from them.
 */

/** What decides who may make the read or write. */
export type GateKind =
  /** `is_member_for_site`: the caller's seat covers the client site. */
  | 'member_for_site'
  /** `seat_may(account, action)`: the caller's role may take the action. */
  | 'seat_may'
  /** `is_member` / `member_role` / `is_member_for_fix`: the caller holds a seat on the account. */
  | 'member'
  /** Rows keyed by the signed-in caller's own user id, or their own session. */
  | 'own_rows'
  /** An unguessable id or token in the URL, a cookie or the body is the credential. */
  | 'capability'
  /** A staff check: the operator list, or the shared admin secret. */
  | 'operator'
  /** A signature or secret the caller must present: Stripe, Inngest, Resend, a cron. */
  | 'signature'
  /** Nothing is private: public data, or a request with nothing to authorise. */
  | 'public'
  /** A module that trusts its callers; `callers` lists them and each is a row or a caller-gated module. */
  | 'caller';

export interface Check {
  /** Repo-relative file where the check runs. It must be the row's own file or one it imports. */
  readonly file: string;
  /** The identifier or string literal that is the check (`is_member_for_site`, `verifyWebhook`). */
  readonly marker: string;
}

export interface Proof {
  /** Repo-relative test file. */
  readonly file: string;
  /** Text of the title of the `it`/`test`/`describe` that fails when the check is removed. */
  readonly test: string;
}

export interface AccessRow {
  readonly kind: 'route' | 'entry' | 'service-client';
  /** A route folder under app/ (as route-policy.ts names it), or a repo-relative file. */
  readonly path: string;
  /** Whom the code acts for. */
  readonly identity: string;
  readonly gate: GateKind;
  /** For `seat_may`: the action asked. */
  readonly action?: string;
  /** One line: what is read or written and how the gate applies. */
  readonly detail: string;
  /** Where the gate runs. Required for every gate but `public` and `caller`. */
  readonly check?: Check;
  /** For `caller`: the repo-relative files that import this module. */
  readonly callers?: readonly string[];
  /** The test that proves the gate. */
  readonly proof: Proof;
  /** For `service-client`: how many service-role clients the file opens (a new one needs review). */
  readonly calls?: number;
  /** An access hole found by CC-37 and not yet closed: the id in `KNOWN_OPEN`. */
  readonly hole?: string;
}
