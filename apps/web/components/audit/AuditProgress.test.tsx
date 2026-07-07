import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuditProgress } from './AuditProgress';

// SPEC 04 §2 — V1 (honest, determinate progress). The bar renders ONLY what real events produced:
//   - no events yet -> an honest indeterminate state (never a fake 0% bar);
//   - pagesCrawled + sitemap estimate -> "N of ~M pages" (the honest denominator);
//   - pagesCrawled without an estimate -> "N pages so far · cap C" (never an invented total);
//   - stalled -> the polite honest stall line, not fake motion.

describe('AuditProgress', () => {
  it('shows the honest indeterminate state before any real event arrives', () => {
    const html = renderToStaticMarkup(<AuditProgress pageCount={0} pageCap={500} status="crawling" />);
    expect(html).toMatch(/starting the crawl/i);
  });

  it('renders "N of ~M pages" ONLY when a sitemap-derived estimate exists', () => {
    const html = renderToStaticMarkup(
      <AuditProgress pageCount={0} pageCap={500} status="crawling" pagesCrawled={37} estimatedTotal={214} />,
    );
    expect(html).toContain('37 of ~214 pages');
  });

  it('falls back to "N pages so far · cap C" when no honest total is derivable', () => {
    const html = renderToStaticMarkup(
      <AuditProgress pageCount={0} pageCap={500} status="crawling" pagesCrawled={12} />,
    );
    expect(html).toMatch(/12 pages so far/);
    expect(html).toMatch(/cap 500/);
    expect(html).not.toContain('~'); // never an invented estimate
  });

  it('sizes the determinate bar from real counts (pagesCrawled / estimatedTotal)', () => {
    const html = renderToStaticMarkup(
      <AuditProgress pageCount={0} pageCap={500} status="crawling" pagesCrawled={50} estimatedTotal={200} />,
    );
    expect(html).toContain('data-testid="progress-bar"');
    expect(html).toContain('width:25%');
  });

  it('shows the honest stall state instead of fake motion when the crawl is stalled', () => {
    const html = renderToStaticMarkup(
      <AuditProgress pageCount={0} pageCap={500} status="crawling" pagesCrawled={8} stalled />,
    );
    expect(html).toMatch(/waiting politely/i);
  });

  it('keeps the legacy completed-count rendering for terminal snapshots (page_count persisted)', () => {
    const html = renderToStaticMarkup(<AuditProgress pageCount={140} pageCap={500} status="crawling" />);
    expect(html).toContain('140 / 500 pages');
  });
});
