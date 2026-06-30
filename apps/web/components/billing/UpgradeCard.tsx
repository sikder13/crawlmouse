import { UpgradeLink } from './UpgradeLink';

/** Reusable inline paywall card (honest cutoff). `returnTo` (an /audit/<id>) lands the user back on
 *  the cure after they upgrade. Used after the locked cures, CSV, page-cap, badge. */
export function UpgradeCard({ headline, sub, returnTo }: { headline: string; sub?: string; returnTo?: string }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-peach bg-peach/5 p-5 text-center">
      <p className="font-display font-semibold text-ink">🐭 {headline}</p>
      {sub && <p className="mt-1 text-sm text-ink/70">{sub}</p>}
      <div className="mt-3 inline-block">
        <UpgradeLink returnTo={returnTo} />
      </div>
    </div>
  );
}
