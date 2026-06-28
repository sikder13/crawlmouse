import Link from 'next/link';
import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import { buttonClasses } from '../ui/Button';
import { Card } from '../ui/Card';
import { UpgradeCard } from '../billing/UpgradeCard';
import { LockedCureCard } from './LockedCureCard';
import { lockedCureCount, sortedLedger } from './result-logic';

// The wall (§3/§4): the rest of the ledger as visible-but-locked cures + the Pro pitch — the
// productive-friction beat. For a Pro owner the cures are unlocked in their dashboard workspace (§5),
// so we point there instead. Gating is driven by entitlement; locked cards carry diagnosis only.
export function CureWall({ audit }: { audit: ClientAuditV2 }) {
  const ledger = audit.projectedGrade?.ledger ?? [];
  const freeFixId = audit.freeFix?.diagnosis.id;
  const locked = sortedLedger(ledger).filter((d) => d.id !== freeFixId);

  // Pro owner — cures unlocked; the action-packet workspace lives in the dashboard.
  if (audit.entitlement.canSeeAllPrescriptions) {
    if (locked.length === 0) return null;
    return (
      <Card variant="raised">
        <div className="text-overline uppercase text-ink-muted">Your action packets</div>
        <p className="mt-2 text-body text-ink-muted">
          You have {locked.length} more {locked.length === 1 ? 'cure' : 'cures'} ready — open them, copy
          the action packets, and re-audit to watch your grade climb.
        </p>
        <Link href={{ pathname: '/dashboard' }} className={buttonClasses({ variant: 'primary', className: 'mt-3' })}>
          Open your dashboard →
        </Link>
      </Card>
    );
  }

  // Free / non-owner — the wall.
  if (!audit.hasMorePrescriptions || locked.length === 0) return null;
  const count = lockedCureCount(audit);
  return (
    <div className="space-y-4">
      <div className="text-overline uppercase text-ink-muted">
        {count} more {count === 1 ? 'fix' : 'fixes'} — cures locked
      </div>
      <div className="space-y-3">
        {locked.map((d) => (
          <LockedCureCard key={d.id} diagnosis={d} />
        ))}
      </div>
      <UpgradeCard
        headline="Unlock every cure + copy-paste AI action packets."
        sub="See exactly which links to add on every page — then re-audit and watch your grade climb."
        returnTo={`/audit/${audit.id}`}
      />
    </div>
  );
}
