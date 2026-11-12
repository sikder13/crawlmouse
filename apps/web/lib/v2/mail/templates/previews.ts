/**
 * Every v2 email template, rendered from fixture data, for the development-only preview pages
 * (`/mail-preview/<slug>`, app/(v2-preview)/mail-preview) and the visual harness's mail baselines
 * (tests/visual/pages.ts `MAIL_PREVIEWS`), which each read this list. Adding a template's preview is
 * one entry here: a slug, a name, its kind and a render over fixture input. Nothing here reads a
 * database, an environment variable or the clock.
 */
import { fixture } from '../../fixtures';
import { packetPrompt } from '../../view/segment/fixes';
import type { MailKind, RenderedMail } from '../types';
import { MAIL_PREVIEW_INDEX, type MailPreviewSlug } from './preview-index';
import { accountDelete, emailChangeConfirm, emailChangeNotice } from './account-links';
import { alertTemplate } from './alert';
import { checkNotify } from './check-notify';
import { fixToDeveloper } from './fix-to-developer';
import { trialReminder } from './trial-reminder';
import { weeklySummaryTemplate } from './weekly-summary';

export interface MailPreview {
  /** The page's path segment: `/mail-preview/<slug>`. */
  slug: string;
  name: string;
  kind: MailKind;
  render(): RenderedMail;
}

/** Stand-in link tokens: the shape `issue_account_link` returns, minted by nothing. */
const TOKEN = 'PREVIEWtokenPREVIEWtokenPREVIEWtokenPREVIEW';
const RESTORE = 'RESTOREtokenRESTOREtokenRESTOREtokenRESTORE';
/** A stand-in unsubscribe page link: the shape `unsubscribeLinks` builds, signed by nothing. */
const UNSUBSCRIBE = 'https://crawlmouse.com/unsubscribe?t=PREVIEW.token';

const bad = () => fixture('bad-site');
const badHost = () => bad().sites[0]!.host;
const badCheck = () => bad().checks[0]!.id;
const badFix = () => bad().fixes.find((f) => f.packet !== null)!;
/** bad-site's changes found by its newest check: what one alert lists. */
const badChanges = () =>
  bad().changes.filter((c) => c.check_id === badCheck() && c.kind !== 'baseline');

const RENDERS: Record<MailPreviewSlug, () => RenderedMail> = {
  'check-notify': () => checkNotify({ host: badHost(), checkId: badCheck(), outcome: 'finished' }),
  'check-notify-failed': () =>
    checkNotify({ host: badHost(), checkId: badCheck(), outcome: 'failed' }),
  'fix-to-developer': () => {
    const fix = badFix();
    return fixToDeveloper({
      host: badHost(),
      fixTitle: fix.title,
      packet: packetPrompt(fix, fix.packet!),
    });
  },
  'trial-reminder': () =>
    trialReminder({
      plan: 'pro',
      variant: 'no_card',
      endsAt: '2026-11-08T02:41:00.000Z',
      timezone: 'America/Indiana/Indianapolis',
    }),
  'email-change-confirm': () => emailChangeConfirm({ token: TOKEN }),
  'email-change-notice': () => emailChangeNotice({ token: TOKEN }),
  'account-delete': () => accountDelete({ confirmToken: TOKEN, restoreToken: RESTORE }),
  alert: () =>
    alertTemplate({
      host: badHost(),
      checkId: badCheck(),
      checkedAt: bad().checks[0]!.finished_at ?? '2026-11-09T06:00:00.000Z',
      zone: 'America/Indiana/Indianapolis',
      changes: badChanges(),
      unsubscribeUrl: UNSUBSCRIBE,
    }),
  'weekly-summary': () =>
    weeklySummaryTemplate({
      since: '2026-11-02T05:00:00.000Z',
      until: '2026-11-09T05:00:00.000Z',
      zone: 'America/Indiana/Indianapolis',
      sites: [{ siteId: bad().sites[0]!.id, host: badHost(), changes: badChanges() }],
      unsubscribeUrl: UNSUBSCRIBE,
    }),
};

export const MAIL_PREVIEWS: readonly MailPreview[] = MAIL_PREVIEW_INDEX.map((p) => ({
  ...p,
  render: RENDERS[p.slug],
}));

export const mailPreview = (slug: string): MailPreview | undefined =>
  MAIL_PREVIEWS.find((p) => p.slug === slug);
