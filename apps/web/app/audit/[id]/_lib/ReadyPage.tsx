import '../../../../styles/v2/tokens.css';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  AuditEvent,
  AuditPageProvider,
} from '../../../../components/v2/screens/result/AuditPage';
import { AuditNotice } from '../../../../components/v2/screens/result/ResultStates';
import { ExplorerScreen } from '../../../../components/v2/screens/map/ExplorerScreen';
import { FixScreen } from '../../../../components/v2/screens/fix/FixScreen';
import { AccessScreen } from '../../../../components/v2/screens/segment/AccessScreen';
import { ChangesScreen } from '../../../../components/v2/screens/segment/ChangesScreen';
import { ContentScreen } from '../../../../components/v2/screens/segment/ContentScreen';
import { NoJsScreen } from '../../../../components/v2/screens/segment/NoJsScreen';
import { SignalsScreen } from '../../../../components/v2/screens/segment/SignalsScreen';
import { StructureScreen } from '../../../../components/v2/screens/segment/StructureScreen';
import { findCheck } from '../../../../lib/v2/fixtures';
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
  if (read.state !== 'ready') redirect(auditHrefs(read.checkId).overview);
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

export async function SegmentPage({ id, segment }: { id: string; segment: SegmentKey }) {
  const read = await readyAudit(id);
  return (
    <AuditPageProvider page={auditPage(read.checkId, 'segment')}>
      {segmentScreen(read, segment)}
    </AuditPageProvider>
  );
}

/** The fix page's view; null when the id names no fix this check's site had by this check. */
export function fixOf(read: ReadyCheck, fixId: string) {
  const fix = read.dataset.fixes.find((f) => f.id === fixId);
  if (!fix) return null;
  const check = findCheck(read.dataset, read.checkId);
  return {
    view: fixView(read.dataset, read.checkId, fixId, viewOptions(read)),
    type: fix.type,
    free: isFreeFix(read.dataset, check, fix),
  };
}

export async function FixPage({ id, fixId }: { id: string; fixId: string }) {
  const read = await readyAudit(id);
  const found = fixOf(read, fixId);
  if (!found) notFound();
  const page = auditPage(read.checkId, 'fix');
  return (
    <AuditPageProvider page={page}>
      <AuditEvent
        event="fix_opened"
        props={{ type: found.type, free: found.free, check_ref: page.checkRef }}
      />
      <FixScreen data={found.view} />
    </AuditPageProvider>
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

export async function MapPage({ id, scope }: { id: string; scope: 'hubs' | 'all' }) {
  const read = await readyAudit(id);
  const data = mapOf(read, scope);
  if (data.nodes.length === 0) {
    return (
      <AuditNotice
        domain={read.host}
        title="This audit has no page to draw"
        lines={[
          'The link map draws the pages a link path from the homepage reaches, and the orphan and JavaScript-only pages beside them. This audit holds none of those.',
        ]}
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
