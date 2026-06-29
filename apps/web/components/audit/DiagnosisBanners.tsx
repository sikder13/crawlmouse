import type { Finding } from '@crawlmouse/types';
import { Card } from '../ui/Card';
import { findingMeta } from './finding-meta';
import { informationalFindings } from './result-logic';

// Site-wide informational findings (js_rendered, incomplete_crawl) rendered as calm banners (§8).
// The js_rendered banner reframes the static read as the edge: AI crawlers (ChatGPT, Claude) don't
// run JavaScript, so they see exactly what Crawlmouse sees — sourced from finding-meta. Returns null
// when there are none.
export function DiagnosisBanners({ findings }: { findings: Finding[] }) {
  const banners = informationalFindings(findings);
  if (banners.length === 0) return null;
  return (
    <div className="space-y-3">
      {banners.map((f, i) => {
        const meta = findingMeta(f.category);
        return (
          <Card key={`${f.category}:${f.pageUrl ?? ''}:${i}`} className="border-l-4 border-l-peach">
            <div className="font-medium text-ink">{meta.label}</div>
            <p className="mt-1 text-caption text-ink-muted">
              {meta.what} {meta.why}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
