'use client';

import { useEffect, useState } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { DripFeedFindings } from '@/components/audit/DripFeedFindings';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { SharePanel } from '@/components/share/SharePanel';
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Button } from '@/components/ui/Button';
import { FREE_PAGE_CAP } from '@/lib/limits';
import type { FindingGroup } from '@/lib/findings';

interface Snapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null; // coerced to a real number server-side (PostgREST serializes numeric as a string)
  page_count?: number | null;
  link_count?: number | null;
  cms_detected?: string | null;
  settings?: { pageCap?: number } | null;
  findingGroups?: FindingGroup[];
  viewerIsPro?: boolean;
  orphanCount?: number;
  avgDepth?: number;
}

export function AuditView({ auditId }: { auditId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // Real per-audit cap (free = 500, Pro = 2000), threaded from the audit's settings via the stream.
  const pageCap = snapshot?.settings?.pageCap ?? FREE_PAGE_CAP;

  useEffect(() => {
    const es = new EventSource(`/api/audits/${auditId}/stream`);
    es.addEventListener('snapshot', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('progress', (e) => setSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('done', (e) => {
      setSnapshot(JSON.parse((e as MessageEvent).data));
      es.close();
    });
    return () => es.close();
  }, [auditId]);

  const completed = snapshot?.status === 'completed';
  const failed = snapshot?.status === 'failed';
  // A terminal status is reached on completed OR failed — never keep spinning. A
  // completed audit with no grade is its own (rare) state, handled below.
  const graded = completed && !!snapshot?.grade && snapshot?.score != null;
  const running = !completed && !failed;

  return (
    <div className="space-y-6">
      {running && <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />}
      {running && <DripFeedFindings active={running} />}
      {graded && (
        <GradeCard
          grade={snapshot!.grade!}
          score={snapshot!.score!}
          orphanCount={snapshot?.orphanCount ?? 0}
          avgDepth={snapshot?.avgDepth ?? 0}
          passing={(snapshot!.score ?? 0) >= 60}
        />
      )}
      {graded && <SharePanel auditId={auditId} />}
      {graded && snapshot?.findingGroups && <FindingsPanel groups={snapshot.findingGroups} />}
      {graded && (snapshot?.viewerIsPro
        ? <a href={`/api/audits/${auditId}/export`}><Button variant="secondary" className="w-full">Download CSV</Button></a>
        : <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
      )}
      {(failed || (completed && !graded)) && (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">
            {failed ? 'Audit failed' : 'Couldn’t grade this site'}
          </h2>
          <p className="mt-2 text-ink/70">
            {failed
              ? 'We hit an error crawling your site. Try again or contact support.'
              : 'The crawl finished but we couldn’t compute a grade — usually a site that blocks crawlers or has no crawlable pages. Try again or contact support.'}
          </p>
        </Card>
      )}
    </div>
  );
}
