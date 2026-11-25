import '../../../../styles/v2/tokens.css';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuditEvent, AuditPageProvider } from '../../../../components/v2/screens/result/AuditPage';
import { AuditNotice } from '../../../../components/v2/screens/result/ResultStates';
import { ExplorerScreen } from '../../../../components/v2/screens/map/ExplorerScreen';
import type { NoticeView } from '../../../../components/v2/screens/account/Notice';
import { FixScreen } from '../../../../components/v2/screens/fix/FixScreen';
import { AccessScreen } from '../../../../components/v2/screens/segment/AccessScreen';
import { ChangesScreen } from '../../../../components/v2/screens/segment/ChangesScreen';
import { ContentScreen } from '../../../../components/v2/screens/segment/ContentScreen';
import { NoJsScreen } from '../../../../components/v2/screens/segment/NoJsScreen';
import { SignalsScreen } from '../../../../components/v2/screens/segment/SignalsScreen';
import { StructureScreen } from '../../../../components/v2/screens/segment/StructureScreen';
import { sessionTheme } from '../../../../lib/v2/account/session-theme';
import { findCheck } from '../../../../lib/v2/fixtures';
import { supportMailto } from '../../../../lib/v2/support/mailto';
import { emailDeveloperAction } from '../../../../lib/v2/view/account-actions';
import { fixView } from '../../../../lib/v2/view/fix';
import { isFreeFix } from '../../../../lib/v2/view/free-fixes';
import { linkMapView } from '../../../../lib/v2/view/link-map';
import { accessView } from '../../../../lib/v2/view/segment/access';
import { changesView } from '../../../../lib/v2/view/segment/changes';
import { contentView } from '../../../../lib/v2/view/segment/content';
import type { SegmentKey } from '../../../../lib/v2/view/segment/frame';
import { nojsView } from '../../../../lib/v2/view/segment/nojs';
import { signalsView } from '../../../../lib/v2/view/segment/signals';
import { structureView } from '../../../../lib/v2/view/segment/structure';
import { readAudit } from './access';
import { auditHrefs } from './hrefs';
import { auditPage, viewOptions, type ReadyCheck } from './page-data';

/**
 * The ready check a sub-page of an audit shows. An id that names no readable check is a 404; a
 * check that is not graded (waiting, failed, expired) has one page, the overview, which says so.
 */
export async function readyAudit(id: string): Promise<ReadyCheck> {
  const read = await readAudit(id);
  if (read === null) notFound();
  if (read.state !== 'ready') redirect(auditHrefs(read.checkId).overview as Route);
  return read;
}

/** One segment's screen for a ready check. */
export function segmentScreen(read: ReadyCheck, segment: SegmentKey): ReactNode {
  const args = [read.dataset, read.checkId, viewOptions(read)] as const;
  switch (segment) {
    case 'access':
      return <AccessScreen data={accessView(...args)} />;
    case 'nojs':
      return <NoJsScreen data={nojsView(...args)} />;
    case 'structure':
      return <StructureScreen data={structureView(...args, read.map)} />;
    case 'content':
      return <ContentScreen data={contentView(...args)} />;
    case 'signals':
      return <SignalsScreen data={signalsView(...args)} />;
    case 'changes':
      return <ChangesScreen data={changesView(...args)} />;
  }
}

/** A segment page's body: the screen, told which audit page it is on. */
export function SegmentBody({ read, segment }: { read: ReadyCheck; segment: SegmentKey }) {
  return (
    <AuditPageProvider page={auditPage(read.checkId, 'segment')}>
      {segmentScreen(read, segment)}
    </AuditPageProvider>
  );
}

export async function SegmentPage({ id, segment }: { id: string; segment: SegmentKey }) {
  // The theme is read beside the audit, and never fails the page (session-theme.tsx).
  const [read, theme] = await Promise.all([readyAudit(id), sessionTheme()]);
  return (
    <>
      {theme}
      <SegmentBody read={read} segment={segment} />
    </>
  );
}

/**
 * The fix page's view, and its support link with the fix's ids (CC-33 D5); null when the id names
 * no fix this check's site had by this check. `developer` is the form that emails the fix: on an
 * open fix of a kept audit, whose reader `readableCheck` has found to be a member, and only with a
 * packet, since the mail is the packet.
 */
export function fixOf(read: ReadyCheck, fixId: string) {
  const fix = read.dataset.fixes.find((f) => f.id === fixId);
  if (!fix) return null;
  const check = findCheck(read.dataset, read.checkId);
  const site = read.dataset.sites.find((s) => s.id === check.site_id);
  const view = fixView(read.dataset, read.checkId, fixId, viewOptions(read));
  return {
    view,
    developer:
      view.kind === 'open' && view.packet !== null && view.frame.keptUntil === null
        ? emailDeveloperAction(fixId, 'Email this fix to my developer', `about: ${view.head.title}`)
        : null,
    type: fix.type,
    free: isFreeFix(read.dataset, check, fix),
    support: supportMailto({
      topic: 'fix',
      path: auditHrefs(read.checkId).fix(fixId),
      accountId: site?.account_id,
      siteId: check.site_id,
      checkId: read.checkId,
      fixId,
      fixType: fix.type,
    }),
  };
}

/** The fix page's body for a fix `fixOf` found. */
export function FixBody({
  read,
  found,
  notice,
}: {
  read: ReadyCheck;
  found: NonNullable<ReturnType<typeof fixOf>>;
  /** What the email form did. Shown only with the form: anyone can type a notice into an address. */
  notice?: NoticeView | null;
}) {
  const page = auditPage(read.checkId, 'fix');
  return (
    <AuditPageProvider page={page}>
      <AuditEvent
        event="fix_opened"
        props={{ type: found.type, free: found.free, check_ref: page.checkRef }}
      />
      <FixScreen
        data={found.view}
        support={found.support}
        developer={found.developer}
        notice={found.developer ? notice : null}
      />
    </AuditPageProvider>
  );
}

export async function FixPage({
  id,
  fixId,
  notice,
}: {
  id: string;
  fixId: string;
  notice?: NoticeView | null;
}) {
  const [read, theme] = await Promise.all([readyAudit(id), sessionTheme()]);
  const found = fixOf(read, fixId);
  if (!found) notFound();
  return (
    <>
      {theme}
      <FixBody read={read} found={found} notice={notice} />
    </>
  );
}

/** The link map of a ready check in `scope`; the hubs scope draws the stored drawing. */
export function mapOf(read: ReadyCheck, scope: 'hubs' | 'all') {
  return linkMapView(read.dataset, read.checkId, {
    ...viewOptions(read),
    scope,
    drawing: read.map ?? undefined,
  });
}

/** The map page's body: the explorer, or a notice when the audit has no page to draw. */
export function MapBody({ read, scope }: { read: ReadyCheck; scope: 'hubs' | 'all' }) {
  const data = mapOf(read, scope);
  if (data.nodes.length === 0) {
    return (
      <AuditNotice
        domain={read.host}
        title={data.noneServed ? data.title : 'This audit has no page to draw'}
        lines={
          data.noneServed
            ? [data.caption]
            : [
                'The link map draws the pages a link path from the homepage reaches, and the orphan and JavaScript-only pages beside them. This audit holds none of those.',
              ]
        }
        action={{ label: 'Back to the result', href: auditHrefs(read.checkId).overview }}
      />
    );
  }
  return (
    <AuditPageProvider page={auditPage(read.checkId, 'map')}>
      <ExplorerScreen data={data} />
    </AuditPageProvider>
  );
}

export async function MapPage({ id, scope }: { id: string; scope: 'hubs' | 'all' }) {
  const [read, theme] = await Promise.all([readyAudit(id), sessionTheme()]);
  return (
    <>
      {theme}
      <MapBody read={read} scope={scope} />
    </>
  );
}
