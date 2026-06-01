'use client';

import { useEffect, useState } from 'react';
import { AuditProgress } from '@/components/audit/AuditProgress';
import { DripFeedFindings } from '@/components/audit/DripFeedFindings';
import { LinkGraph, type LinkGraphPage, type LinkGraphEdge } from '@/components/audit/LinkGraph';
import { GradeCard } from '@/components/ui/GradeCard';
import { Card } from '@/components/ui/Card';
import { SharePanel } from '@/components/share/SharePanel';
import { FindingsPanel } from '@/components/audit/FindingsPanel';
import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Button } from '@/components/ui/Button';
import type { FindingGroup } from '@/lib/findings';

interface Snapshot {
  id: string;
  status: string;
  grade?: string | null;
  score?: number | null;
  page_count?: number | null;
  link_count?: number | null;
  cms_detected?: string | null;
  user_id?: string | null;
  settings?: { pageCap?: number } | null;
  findingGroups?: FindingGroup[];
  viewerIsPro?: boolean;
}

interface FullData { pages: LinkGraphPage[]; edges: LinkGraphEdge[]; homepageUrl: string; orphanCount: number; avgDepth: number }

export function AuditView({ auditId }: { auditId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [full] = useState<FullData | null>(null);
  // Real per-audit cap (free = 500, Pro = 2000), threaded from the audit's settings via the stream.
  const pageCap = snapshot?.settings?.pageCap ?? 500;

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

  const done = snapshot?.status === 'completed' && snapshot.grade;
  const failed = snapshot?.status === 'failed';
  const running = !done && !failed;

  return (
    <div className="space-y-6">
      {running && <AuditProgress pageCount={snapshot?.page_count ?? 0} pageCap={pageCap} status={snapshot?.status ?? 'pending'} />}
      {running && <DripFeedFindings active={running} />}
      {full && <LinkGraph pages={full.pages} edges={full.edges} homepageUrl={full.homepageUrl} height={500} />}
      {done && snapshot.grade && snapshot.score != null && (
        <GradeCard
          grade={snapshot.grade}
          score={snapshot.score}
          orphanCount={full?.orphanCount ?? 0}
          avgDepth={full?.avgDepth ?? 0}
          passing={(snapshot.score ?? 0) >= 60}
        />
      )}
      {done && <SharePanel auditId={auditId} />}
      {done && snapshot.findingGroups && (
        <FindingsPanel groups={snapshot.findingGroups} />
      )}
      {done && (snapshot.viewerIsPro
        ? <a href={`/api/audits/${auditId}/export`}><Button variant="secondary" className="w-full">Download CSV</Button></a>
        : <UpgradeCard headline="Export every finding + page as CSV." sub="Sortable spreadsheet of your whole site." />
      )}
      {failed && (
        <Card>
          <h2 className="font-display font-bold text-2xl text-warning">Audit failed</h2>
          <p className="mt-2 text-ink/70">We hit an error crawling your site. Try again or contact support.</p>
        </Card>
      )}
    </div>
  );
}
