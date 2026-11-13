/**
 * The page a client report's recipient lands on from the confirmation link or the pause link, as
 * data (CC-31 D8). It says what the button will do, and offers the one button; after the press it
 * says what was done; for a link that cannot be used it says so and offers nothing.
 */
import { LINK_FLOWS } from '../account/link-cookie';
import type { NoticeCode } from '../account/route';
import { RECIPIENT_COPY as COPY } from '../copy/agency-reports';
import { NOTICE_LINES } from '../copy/notices';
import { RECIPIENT_LINKS, type RecipientLink } from './schedules';
import type { RecipientLinkView } from './schedules-store';

export interface RecipientLinkPageView {
  state: 'link' | 'done' | 'gone';
  title: string;
  lines: string[];
  /** The form's route and its button: it posts no field. Null once done, and for a dead link. */
  act: { action: string; label: string } | null;
  /**
   * On the confirmation page and the pause page: the line and the button that stop the requests
   * for good. Its form names the page's own link (`from`), whose cookie holds the token.
   */
  also: { line: string; action: string; label: string; from: 'confirm' | 'pause' } | null;
}

/**
 * `link` is what the cookie's token opens, or null; `notice` is the page's `?notice=`, set by the
 * form's answer. A notice of the other page's, and a link of the other kind, are not this page's.
 */
export function recipientLinkView(
  kind: RecipientLink,
  link: RecipientLinkView | null,
  notice: NoticeCode | null,
  /** For "Don't ask me again": whether the page's cookie holds a token at all. */
  held = link !== null,
): RecipientLinkPageView {
  const { flow, done } = RECIPIENT_LINKS[kind];
  const none = { act: null, also: null };
  if (notice === done) {
    return { state: 'done', title: COPY[kind].done, lines: [NOTICE_LINES[done](null)], ...none };
  }
  const act = { action: LINK_FLOWS[flow].api, label: COPY[kind].button };
  if (kind === 'decline') {
    // A refusal does not expire: a token the read no longer answers for (a confirmation link past
    // its seven days) is still pressed, and the press says whether it could be used.
    if (!held) return { state: 'gone', title: COPY.gone.title, lines: [COPY.gone.line], ...none };
    return {
      state: 'link',
      title: COPY.decline.title,
      lines: link
        ? COPY.decline.lines(link.accountName ?? COPY.someone, link.host)
        : [...COPY.decline.plain],
      act,
      also: null,
    };
  }
  if (link?.kind !== kind) {
    return { state: 'gone', title: COPY.gone.title, lines: [COPY.gone.line], ...none };
  }
  return {
    state: 'link',
    title: COPY[kind].title,
    lines: COPY[kind].lines(link.accountName ?? COPY.someone, link.host),
    act,
    also: {
      line: COPY.forGood,
      action: LINK_FLOWS.reportDecline.api,
      label: COPY.declineButton,
      from: kind,
    },
  };
}
