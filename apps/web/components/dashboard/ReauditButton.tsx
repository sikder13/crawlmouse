'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReauditResponse } from '../../lib/contract-v1_2';
import { trackRaw } from '@/lib/analytics';
import { reauditTargetId } from './dashboard-logic';
import { Button } from '../ui/Button';

// One-tap re-audit (the audit → fix → re-audit → watch-it-climb loop as one action). Consumes SPEC 02's
// POST /api/audits/[id]/reaudit → ReauditResponse.newAuditId → /audit/[newId]. Mocked until that endpoint
// ships at integration; on failure it simply resets.
export function ReauditButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function reaudit() {
    setRunning(true);
    trackRaw('reaudit_clicked', { auditId });
    try {
      const res = await fetch(`/api/audits/${auditId}/reaudit`, { method: 'POST' });
      if (res.ok) {
        const target = reauditTargetId((await res.json()) as ReauditResponse);
        if (target) {
          router.push(`/audit/${target}`);
          return;
        }
      }
      setRunning(false);
    } catch {
      setRunning(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={reaudit} loading={running}>
      Re-audit
    </Button>
  );
}
