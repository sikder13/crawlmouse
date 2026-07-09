'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WhiteLabelConfig } from '@crawlmouse/types';
import { Button } from '@/components/ui/Button';
import { track } from '@/lib/analytics';
import { logoClientPrecheck, LOGO_ACCEPT } from '@/lib/logo-precheck';
import { uploadLogo } from '@/lib/logo-upload';
import { saveWhiteLabel } from '@/lib/white-label-save';

interface Props {
  slug: string;
  /** Pro entitlement from the probe (R2). Free owners get the locked upsell — the server rejects anyway. */
  canWhiteLabel: boolean;
  /** Current white-label config from the probe (null = Crawlmouse-branded). */
  whiteLabel: WhiteLabelConfig | null;
  /** Refetch the probe (+ refresh the ISR brand header) after a successful write (R2). */
  onSaved: () => void;
  /** Called on the OFF→ON transition — opens the private-vs-public visibility prompt (§4). */
  onEnabled: () => void;
}

// SPEC 04.1 §3 — the inline white-label control (also reused in the dashboard). Every write goes to the
// shipped, server-gated white-label + logo routes; the locked/enabled state here is COSMETIC (a free or
// non-owner forced write is rejected 402/403 server-side). The logo file is client-pre-checked for UX,
// but the server byte-validation is authoritative (U4). Fires `whitelabel_enabled` on OFF→ON (§7).
export function WhiteLabelControls({ slug, canWhiteLabel, whiteLabel, onSaved, onEnabled }: Props) {
  const enabled = whiteLabel != null;
  const [brandName, setBrandName] = useState(whiteLabel?.brandName ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!canWhiteLabel) {
    return (
      <div className="rounded-card border border-oat p-4">
        <div className="text-overline uppercase text-ink-muted">Your branding</div>
        <p className="mt-2 text-caption text-ink-muted">
          <span aria-hidden="true">🔒</span> Replace the Crawlmouse wordmark with your own name and logo — on
          this report, its PDF, and its share card.
        </p>
        <Link
          href={{ pathname: '/pricing' }}
          className="mt-3 inline-block rounded-control bg-peach px-4 py-2 text-caption font-medium text-white"
        >
          Add your brand — upgrade to Pro
        </Link>
      </div>
    );
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f) {
      const pre = logoClientPrecheck(f);
      if (!pre.ok) {
        setError(pre.reason === 'type' ? 'Use a PNG, JPEG, or WebP image.' : 'Logo must be 200 KB or smaller.');
        setFile(null);
        setFileName(null);
        return;
      }
    }
    setFile(f);
    setFileName(f?.name ?? null);
  }

  function mapError(err: string | undefined): string {
    if (err === 'auth_required') return 'Your session expired — please sign in again.';
    if (err === 'pro_required') return 'White-label is a Pro feature.';
    if (err === 'verification_required') return 'Verify your domain first.';
    if (err === 'not_claimed') return 'Claim this report first.';
    if (err === 'rate_limited') return 'Too many changes — please try again shortly.';
    if (err === 'unavailable') return 'Branding isn’t available yet — please try again shortly.';
    return 'Could not save your branding — please try again.';
  }

  async function save() {
    const name = brandName.trim();
    if (name.length === 0) {
      setError('Enter a brand name.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);

    // Preserve the existing logo on a brand-name-only edit (the route null-defaults an omitted logoPath).
    let logoPath: string | null = whiteLabel?.logoPath ?? null;
    if (file) {
      const up = await uploadLogo(slug, file, fetch);
      if (!up.ok) {
        setError(
          up.error === 'unavailable'
            ? 'Logo uploads aren’t available yet.'
            : up.error === 'rate_limited'
              ? 'Too many uploads — please try again shortly.'
              : 'Could not upload that logo.',
        );
        setBusy(false);
        return;
      }
      logoPath = up.logoPath ?? null;
    }

    const wasEnabled = enabled;
    const r = await saveWhiteLabel(slug, { enabled: true, brandName: name, logoPath }, fetch);
    if (!r.ok) {
      setError(mapError(r.error));
      setBusy(false);
      return;
    }
    setBusy(false);
    setNotice('Branding saved. Your report will show it in a moment.');
    if (!wasEnabled) {
      track('whitelabel_enabled', { slug });
      onEnabled(); // OFF→ON → the private-vs-public prompt (§4)
    }
    onSaved(); // refetch + refresh the ISR brand header (R2)
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await saveWhiteLabel(slug, { enabled: false }, fetch);
    if (!r.ok) {
      setError(mapError(r.error));
      setBusy(false);
      return;
    }
    setBusy(false);
    setNotice('Crawlmouse branding restored.');
    onSaved();
  }

  return (
    <div className="rounded-card border border-oat p-4">
      <div className="text-overline uppercase text-ink-muted">Your branding</div>

      <label htmlFor="wl-brand" className="mt-2 block text-caption text-ink-muted">Brand name</label>
      <input
        id="wl-brand"
        name="brandName"
        type="text"
        maxLength={60}
        value={brandName}
        onChange={(e) => setBrandName(e.target.value)}
        placeholder="Your company"
        className="mt-1 w-full rounded-control border border-oat bg-cream px-3 py-2 text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-peach"
      />

      <label htmlFor="wl-logo" className="mt-3 block text-caption text-ink-muted">Logo — PNG, JPEG, or WebP, ≤ 200 KB</label>
      <input id="wl-logo" type="file" accept={LOGO_ACCEPT} onChange={onPickFile} className="mt-1 block w-full text-caption" />
      {fileName && <p className="mt-1 text-caption text-ink-muted">Selected: {fileName}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : enabled ? 'Save branding' : 'Enable my brand'}
        </Button>
        {enabled && (
          <Button size="sm" variant="secondary" type="button" onClick={turnOff} disabled={busy}>
            Turn off branding
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-caption text-warning">{error}</p>}
      {notice && <p className="mt-2 text-caption text-sage">{notice}</p>}
    </div>
  );
}
