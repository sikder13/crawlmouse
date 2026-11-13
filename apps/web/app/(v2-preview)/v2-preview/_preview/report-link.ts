/**
 * The previews of the page a client report's recipient lands on (CC-31 D8). The link each reads is a
 * stand-in defined here: no fixture holds a recipient's link.
 */
import {
  recipientLinkView,
  type RecipientLinkPageView,
} from '../../../../lib/v2/agency/schedules-link-view';

const STAND_IN = { host: 'example-outfitter.com', accountName: 'Summit Digital' };

export const REPORT_LINK_PREVIEWS = {
  /** The confirmation link, before the button is pressed. */
  '/v2-preview/screens/report-link': (): RecipientLinkPageView =>
    recipientLinkView('confirm', { kind: 'confirm', ...STAND_IN }, null),
  /** The pause link, before the button is pressed. */
  '/v2-preview/screens/report-link/pause': (): RecipientLinkPageView =>
    recipientLinkView('pause', { kind: 'pause', ...STAND_IN }, null),
  /** A link that cannot be used. */
  '/v2-preview/screens/report-link/gone': (): RecipientLinkPageView =>
    recipientLinkView('confirm', null, null),
} as const;

export type ReportLinkPreview = keyof typeof REPORT_LINK_PREVIEWS;
