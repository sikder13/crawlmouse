import { safeDecodeUrlForDisplay } from '@/lib/url-display';

// SPEC 04.3 — the audit result page header shows the AUDITED URL. When someone audits a non-ASCII-path
// URL (e.g. a Cyrillic Wikipedia article) it arrives percent-encoded, so a raw render leaks "%xx" — the
// same class as the dashboard SiteCard's audited URL (already decoded in 04.2). Extracted from
// app/audit/[id]/page.tsx so this display decode is render-testable in the cross-surface visible-% guard.
// Display-only: the decoded value is shown to humans, never used as an href, a ?ref, or a stored value.
export function AuditUrlHeader({ url }: { url: string }) {
  return (
    <div className="mb-6">
      <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">Auditing</div>
      <h1 className="font-mono text-lg break-all">{safeDecodeUrlForDisplay(url)}</h1>
    </div>
  );
}
