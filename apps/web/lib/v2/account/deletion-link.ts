/**
 * The deletion's two link pages and their POSTs (D4, plan-revision R3). The emailed link lands on a
 * route that puts its token in the flow's cookie (`landLink`); the page reads the link from that
 * cookie without using it (`read_deletion_link`); its form posts to the flow's API route, which takes
 * the token from the cookie, never from a URL or the body.
 */
import { z } from 'zod';
import { readBody } from '../../billing/request-body';
import {
  clearLinkCookie,
  LINK_FLOWS,
  LINK_RESPONSE_HEADERS,
  linkToken,
  type LinkFlow,
} from './link-cookie';
import type { DeletionAnswer, DeletionPorts, Rpc } from './deletion';
import { hashToken, isToken } from './tokens';

export type DeletionFlow = Extract<LinkFlow, 'deleteConfirm' | 'restore'>;

const KIND = { deleteConfirm: 'delete_confirm', restore: 'delete_restore' } as const;

/** What a page shows: the link's accounts, or why it has none. */
export type DeletionLinkView =
  | {
      ok: true;
      /** `subscription`: the status of the plan the account follows, or null (read_deletion_link). */
      accounts: Array<{ id: string; host: string; subscription: string | null }>;
      purgeAfter: string | null;
    }
  | { ok: false; code: string };

/** The page's read of its link, from the flow's cookie value (or none). Uses nothing. */
export async function readDeletionLink(
  rpc: Rpc,
  flow: DeletionFlow,
  token: string | undefined,
  now: Date,
): Promise<DeletionLinkView> {
  if (!isToken(token)) return { ok: false, code: 'invalid_link' };
  const r = await rpc<DeletionLinkView & { userId?: string }>('read_deletion_link', {
    p_kind: KIND[flow],
    p_hash: hashToken(token),
    p_now: now.toISOString(),
  });
  // The page shows no id of the person.
  return r.ok ? { ok: true, accounts: r.accounts, purgeAfter: r.purgeAfter } : r;
}

/** The result a form post goes back to its page with: the refusal's code, or what was done. */
export const DONE: Readonly<Record<DeletionFlow, string>> = {
  deleteConfirm: 'deleted',
  restore: 'restored',
};

/** Codes after which the link cannot be used again, so its cookie goes. */
const SPENT = new Set(['invalid_link', 'window_closed', 'already_confirmed']);

/** The form carries no field: the token is in the cookie. */
const NoFields = z.strictObject({});

/**
 * The flow's POST: the token from the cookie, then `act`. A form is answered with a 303 to the page
 * with `?result=`, JSON with the answer. The cookie is cleared once the link is used or spent.
 */
export async function postDeletionLink(
  req: Request,
  origin: string,
  flow: DeletionFlow,
  act: (ports: DeletionPorts, token: string) => Promise<DeletionAnswer>,
  ports: () => DeletionPorts,
): Promise<Response> {
  const body = await readBody(req);
  if (body === null || !NoFields.safeParse(body.fields).success) {
    return Response.json({ code: 'invalid' }, { status: 400, headers: LINK_RESPONSE_HEADERS });
  }
  const token = linkToken(req.headers.get('cookie'), flow);
  const answer: DeletionAnswer =
    token === null ? { ok: false, status: 410, code: 'invalid_link' } : await act(ports(), token);
  const result = answer.ok ? DONE[flow] : answer.code;
  const res =
    body.kind === 'form'
      ? new Response(null, {
          status: 303,
          headers: {
            ...LINK_RESPONSE_HEADERS,
            Location: `${origin}${LINK_FLOWS[flow].page}?result=${result}`,
          },
        })
      : Response.json(answer.ok ? { result } : { code: answer.code }, {
          status: answer.ok ? 200 : answer.status,
          headers: LINK_RESPONSE_HEADERS,
        });
  if (answer.ok || SPENT.has(result)) res.headers.append('Set-Cookie', clearLinkCookie(flow));
  return res;
}
