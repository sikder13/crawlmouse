/**
 * How the email change's two link routes answer (`/api/account/email/confirm` and `/undo`). A form
 * post from the flow's page is sent back to the page, with `?done=1` or `?error=<code>`; JSON gets
 * `{ done: true }` or the refusal. Every answer carries no-store and no-referrer, and, once the
 * token reached the database, the `Set-Cookie` that removes the flow's cookie.
 */
import type { BodyKind } from '../../billing/request-body';
import type { EmailChangeOutcome } from './email-change';
import { clearLinkCookie, LINK_FLOWS, LINK_RESPONSE_HEADERS, type LinkFlow } from './link-cookie';
import { refuse } from './route';

export function linkAnswer(
  kind: BodyKind,
  origin: string,
  flow: LinkFlow,
  outcome: EmailChangeOutcome,
  clearCookie: boolean,
): Response {
  const query = outcome.ok ? 'done=1' : `error=${outcome.code}`;
  const res =
    kind === 'form'
      ? new Response(null, {
          status: 303,
          headers: { Location: `${origin}${LINK_FLOWS[flow].page}?${query}` },
        })
      : outcome.ok
        ? Response.json({ done: true })
        : refuse(outcome.status, outcome.code);
  for (const [name, value] of Object.entries(LINK_RESPONSE_HEADERS)) res.headers.set(name, value);
  if (clearCookie) res.headers.append('Set-Cookie', clearLinkCookie(flow));
  return res;
}
