/**
 * What the audit pages share once a check is ready: the options each view takes on a real page,
 * and what the screens are told about the page they are on.
 */
import type { CheckRead } from '../../../../lib/v2/pipeline/public';
import { checkRef } from '../../../../lib/v2/pipeline/public';
import type { AuditPage } from '../../../../components/v2/screens/result/AuditPage';
import { auditHrefs, type AuditHrefs } from './hrefs';

export type ReadyCheck = Extract<CheckRead, { state: 'ready' }>;

/**
 * The options of a view on an audit page: the page's routes, the reader's plan, and no "Re-run"
 * in the header (a re-run of a kept site belongs to its site page, and an anonymous one is a new
 * audit from the home page).
 */
export function viewOptions(read: ReadyCheck): {
  hrefs: AuditHrefs;
  plan: ReadyCheck['plan'];
  rerun: false;
} {
  return { hrefs: auditHrefs(read.checkId), plan: read.plan, rerun: false };
}

/**
 * The page as its screens see it. No control of `AuditLinks` has a route in this step (Share:
 * the public report, wave 2; Re-run and "Email this fix": the site page and the emails), so none
 * is rendered.
 */
export const auditPage = (checkId: string, from: AuditPage['from']): AuditPage => ({
  checkId,
  checkRef: checkRef(checkId),
  from,
  links: {},
});
