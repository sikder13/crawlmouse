import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Card } from '@/components/ui/Card';
import type { FindingGroup } from '@/lib/findings';

const LABELS: Record<string, string> = {
  orphan: 'Orphan pages', near_orphan: 'Near-orphan pages', deep_page: 'Pages too deep',
  unreachable_page: 'Unreachable pages', over_optimized_anchor: 'Over-optimized anchors',
  generic_anchor_overuse: 'Generic anchor overuse', under_linked_important: 'Under-linked key pages',
  incomplete_crawl: 'Too few pages to grade confidently (grade capped)',
  js_rendered: 'This site renders its links with JavaScript',
};

// "Informational" categories are site-wide caveats, not lists of offending pages: they carry
// no per-page rows, so the standard list renderer would show a single bare "—" placeholder
// (and a misleading "· N found" count / an irrelevant UpgradeCard). Render these as a clean
// message banner instead. js_rendered (A4) explains why orphan detection was withheld;
// incomplete_crawl explains why the grade is capped (this also fixes the known bare-"—" nit).
const INFORMATIONAL: Record<string, string> = {
  js_rendered:
    "Your links are built in the browser, so AI crawlers like ChatGPT and Claude can't see them either. Crawlmouse reads the same static HTML they do, so we held back orphan detection here.",
  incomplete_crawl: 'We reached too few pages to certify a confident grade, so the score is capped.',
};

// `groups` is computed + capped server-side (see groupAndCapFindings); this is presentation only.
export function FindingsPanel({ groups }: { groups: FindingGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const label = LABELS[g.category] ?? g.category;

        // Informational banner: headline + short explanatory sub, no count, no rows, no UpgradeCard.
        const sub = INFORMATIONAL[g.category];
        if (sub !== undefined) {
          return (
            <Card key={g.category}>
              <div className="font-display font-bold text-lg">{label}</div>
              <p className="text-ink/70 text-sm mt-1">{sub}</p>
            </Card>
          );
        }

        return (
          <Card key={g.category}>
            <div className="font-display font-bold text-lg mb-3">
              {label} <span className="text-ink/50 font-normal text-sm">· {g.total} found{g.hidden > 0 ? `, showing ${g.shown.length}` : ''}</span>
            </div>
            <ul className="space-y-1 font-mono text-sm">
              {g.shown.map((r, i) => <li key={i} className="text-ink/80 truncate">{r.pages?.url ?? '—'}</li>)}
            </ul>
            {g.hidden > 0 && (
              <div className="mt-4">
                <UpgradeCard headline={`${g.hidden} more ${label.toLowerCase()} are hiding.`} sub="See them all + export CSV" />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
