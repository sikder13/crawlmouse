export type CancelDecision = { allowed: true } | { allowed: false; status: number; error: string };

interface CancelableAudit {
  user_id: string | null;
  anonymous_session_id: string | null;
  status: string;
}
interface CancelViewer {
  userId: string | null;
  anonSessionId: string | null;
}

/**
 * Decide whether `viewer` may cancel `audit`. Mirrors the ownership model used elsewhere: a
 * logged-in audit (user_id set) is cancelable only by its owner; an anonymous audit (user_id null)
 * only by the browser that started it (matching anonymous_session_id cookie) — NOT by anyone who
 * merely holds the capability URL, since cancel is a state-changing action. Only a non-terminal
 * audit (pending/crawling) can be canceled; a terminal one returns 409.
 */
export function authorizeCancel(audit: CancelableAudit, viewer: CancelViewer): CancelDecision {
  const isOwner = audit.user_id
    ? viewer.userId === audit.user_id
    : audit.anonymous_session_id != null && viewer.anonSessionId === audit.anonymous_session_id;
  if (!isOwner) return { allowed: false, status: 403, error: 'forbidden' };
  if (audit.status !== 'pending' && audit.status !== 'crawling') {
    return { allowed: false, status: 409, error: 'not_cancelable' };
  }
  return { allowed: true };
}
