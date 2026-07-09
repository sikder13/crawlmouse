'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnershipProbe } from '@/lib/report-owner-probe';
import { WhiteLabelControls } from './WhiteLabelControls';
import { VisibilityControls } from './VisibilityControls';
import { WhiteLabelVisibilityPrompt } from './WhiteLabelVisibilityPrompt';

interface Props {
  /** A verified owner of a claimed report (probe.owned && probe.claimed). */
  probe: OwnershipProbe;
  slug: string;
  /** Reload the probe (R2 single source of truth) after any write. */
  refetch: () => void;
}

// SPEC 04.1 §3/§4 — the owner's control surface for a claimed report. Every control derives its state
// from the probe (R2) and, after a successful write, calls `afterWrite`, which BOTH refetches the probe
// (so the controls reflect the new state) AND refreshes the ISR page (so the server-rendered brand
// header updates — the write route already purged the cache tag). Visibility controls + the
// private-vs-public prompt (§4) mount alongside the white-label control here.
export function OwnerControls({ probe, slug, refetch }: Props) {
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);
  const afterWrite = () => {
    refetch();
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <WhiteLabelControls
        slug={slug}
        canWhiteLabel={probe.canWhiteLabel === true}
        whiteLabel={probe.whiteLabel ?? null}
        onSaved={afterWrite}
        onEnabled={() => setShowPrompt(true)}
      />
      {showPrompt && (
        <WhiteLabelVisibilityPrompt
          slug={slug}
          onResolved={() => {
            setShowPrompt(false);
            afterWrite();
          }}
        />
      )}
      <VisibilityControls
        slug={slug}
        listed={probe.listed === true}
        indexable={probe.indexable === true}
        onWrite={afterWrite}
      />
    </div>
  );
}
