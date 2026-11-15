/**
 * The shape of the access matrix (CC-37 D1). One row for each route handler, each server entry file
 * that reads data, and each file that opens a service-role client. access-matrix.test.ts holds the
 * rows to the disk and to the code; access-matrix.render.ts writes docs/ops/access-matrix.md from them.
 */

/**
 * The directories whose non-test sources the matrix reads for service-role clients (here, not in
 * access-surface.ts, so the renderer can name them without loading the walker).
 */
export const ADMIN_ROOTS = [
  'apps/web/app',
  'apps/web/lib',
  'apps/web/components',
  'inngest',
] as const;

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
  /**
   * A module that trusts its callers; `callers` lists its importers, and every chain of importers
   * from it must end at a row whose gate is neither `caller` nor `public`.
   */
  | 'caller';

export interface Check {
  /** Repo-relative file where the check runs. It must be the row's own file or one it imports. */
  readonly file: string;
  /**
   * The check: a function or method called by that name (`verifyWebhook`, `isOperator`), or the
   * RPC `.rpc('<marker>')`. Its result must be used (access-surface.ts `markerCalls`).
   */
  readonly marker: string;
  /**
   * When set, the string the call's first argument must be: `{ marker: 'eq', arg: 'audit_id' }` is
   * the capability filter `.eq('audit_id', …)`.
   */
  readonly arg?: string;
}

export interface Proof {
  /** Repo-relative test file. Its import closure must reach the row's file or its check's file. */
  readonly file: string;
  /**
   * The whole title of one `it`/`test` in that file that runs (not `describe`, `.skip`, `.todo`,
   * `.fails`, `.only`), as `it.each` renders it. Which tests fail when a check's refusal branch is
   * removed is measured by the mutation sweep (notes `sweep-A.md`), not by this field.
   */
  readonly test: string;
  /**
   * `'caller-check'`: the proof is the matrix's own caller check (a `caller` row alone), which holds
   * that every chain of importers ends at a gated row. Such a proof is exempt from the closure rule.
   */
  readonly via?: 'caller-check';
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
  /**
   * For `caller`: why a `public` row is an acceptable end of a chain of importers from this module.
   * Without it, a chain that ends at a public row fails the matrix; with it, the matrix also
   * requires that some chain does end at one, so a reason cannot outlive its need.
   */
  readonly publicCallers?: string;
}
