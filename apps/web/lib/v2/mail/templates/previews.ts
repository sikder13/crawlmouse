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
  /**
   * The message over fixture data. `unsubscribeUrl` replaces the stand-in footer link of alert and
   * summary mail, so a sample built with real `unsubscribeLinks` shows one token throughout.
   */
  render(opts?: PreviewOptions): RenderedMail;
}

export interface PreviewOptions {
  unsubscribeUrl?: string;
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
const badSite = () => bad().sites[0]!.id;
/** The site's changes, baselines left out: what a week's summary lists. */
const siteChanges = () =>
  bad().changes.filter((c) => c.site_id === badSite() && c.kind !== 'baseline');
/**
 * The site's check whose changes show every line an alert can carry: an opened change with a fix (the
 * fix link), a grade whose letter moved (the grade line) and more than one kind of where.
 */
const alertCheck = () =>
  bad().checks.find((ch) => {
    const cs = siteChanges().filter((c) => c.check_id === ch.id);
    return (
      cs.some((c) => c.kind === 'opened' && c.fix_id !== null) &&
      cs.some((c) => c.grade_deltas.some((d) => d.from_grade !== d.to_grade)) &&
      new Set(cs.map((c) => c.where)).size > 1
    );
  })!;
/** The days the fixture's changes fall on, so the summary's "from … to …" holds what it lists. */
const summaryWeek = () => {
  const days = siteChanges().map((c) => Date.parse(c.detected_at));
  const day = 86_400_000;
  return {
    since: new Date(Math.floor(Math.min(...days) / day) * day).toISOString(),
    until: new Date((Math.floor(Math.max(...days) / day) + 1) * day).toISOString(),
  };
};
/** What one alert lists: that check's changes. */
const alertChanges = () => siteChanges().filter((c) => c.check_id === alertCheck().id);

const RENDERS: Record<MailPreviewSlug, (opts?: PreviewOptions) => RenderedMail> = {
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
  alert: (opts) =>
    alertTemplate({
      host: badHost(),
      checkId: alertCheck().id,
      checkedAt: alertCheck().finished_at ?? '2026-11-09T06:00:00.000Z',
      zone: 'America/Indiana/Indianapolis',
      changes: alertChanges(),
      unsubscribeUrl: opts?.unsubscribeUrl ?? UNSUBSCRIBE,
    }),
  'weekly-summary': (opts) =>
    weeklySummaryTemplate({
      ...summaryWeek(),
      zone: 'America/Indiana/Indianapolis',
      sites: [{ siteId: badSite(), host: badHost(), changes: siteChanges() }],
      unsubscribeUrl: opts?.unsubscribeUrl ?? UNSUBSCRIBE,
    }),
};

export const MAIL_PREVIEWS: readonly MailPreview[] = MAIL_PREVIEW_INDEX.map((p) => ({
  ...p,
  render: RENDERS[p.slug],
}));

export const mailPreview = (slug: string): MailPreview | undefined =>
  MAIL_PREVIEWS.find((p) => p.slug === slug);
