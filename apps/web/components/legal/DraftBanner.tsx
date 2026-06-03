export function DraftBanner() {
  return (
    <div className="mb-8 rounded-xl border border-peach/40 bg-peach/10 px-4 py-3 text-sm text-ink/80">
      <strong className="font-semibold">Founder draft.</strong> This document is accurate to our
      current practices but is pending review by counsel. Questions?{' '}
      <a className="underline" href="mailto:privacy@crawlmouse.com">privacy@crawlmouse.com</a>.
    </div>
  );
}
