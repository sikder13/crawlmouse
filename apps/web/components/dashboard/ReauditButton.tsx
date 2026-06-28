'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackRaw } from '@/lib/analytics';
import { Button } from '../ui/Button';

// One-tap re-audit (the audit → fix → re-audit → watch-it-climb loop as one action). Consumes
// SPEC 02's POST /api/audits/[id]/reaudit (→ new audit id → /audit/[newId]) — mocked until that
// endpoint ships at integration; on failure it simply resets.
export function ReauditButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function reaudit() {
    setRunning(true);
    trackRaw('reaudit_clicked', { auditId });
    try {
      const res = await fetch(`/api/audits/${auditId}/reaudit`, { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { auditId?: string };
        if (data.auditId) {
          router.push(`/audit/${data.auditId}`);
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
