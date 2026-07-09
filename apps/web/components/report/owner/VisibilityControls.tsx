'use client';

import { useState } from 'react';
import { track } from '@/lib/analytics';
import { saveVisibility } from '@/lib/visibility-save';

interface Props {
  slug: string;
  listed: boolean;
  indexable: boolean;
  /** Refetch the probe (+ refresh) after a successful write (R2). */
  onWrite: () => void;
}

function Switch({ label, on, busy, onToggle }: { label: string; on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-body">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-sage-fill' : 'bg-oat'} disabled:opacity-60`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

// SPEC 04.1 §4 — owner visibility controls for a claimed report. The listed toggle fires
// `leaderboard_opt_in` (on) / `report_hidden` (off) (§7); indexable is a plain opt in/out. State is the
// probe's (R2) — after a write the caller refetches, so these reflect the server truth. The write route
// is the gate; these switches are cosmetic.
export function VisibilityControls({ slug, listed, indexable, onWrite }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleListed() {
    const next = !listed;
    setBusy(true);
    setError(null);
    const r = await saveVisibility(slug, { listed: next }, fetch);
    if (!r.ok) {
      setError(r.error === 'rate_limited' ? 'Too many changes — please try again shortly.' : 'Could not update visibility — please try again.');
      setBusy(false);
      return;
    }
    track(next ? 'leaderboard_opt_in' : 'report_hidden', { slug });
    setBusy(false);
    onWrite();
  }

  async function toggleIndexable() {
    setBusy(true);
    setError(null);
    const r = await saveVisibility(slug, { indexable: !indexable }, fetch);
    if (!r.ok) {
      setError(r.error === 'rate_limited' ? 'Too many changes — please try again shortly.' : 'Could not update visibility — please try again.');
      setBusy(false);
      return;
    }
    setBusy(false);
    onWrite();
  }

  return (
    <div className="rounded-card border border-oat p-4">
      <div className="text-overline uppercase text-ink-muted">Visibility</div>
      <Switch label="Listed on leaderboards & sitemap" on={listed} busy={busy} onToggle={toggleListed} />
      <Switch label="Indexable by Google" on={indexable} busy={busy} onToggle={toggleIndexable} />
      {error && <p className="mt-2 text-caption text-warning">{error}</p>}
    </div>
  );
}
