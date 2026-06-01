import { UpgradeCard } from '@/components/billing/UpgradeCard';
import { Card } from '@/components/ui/Card';
import type { FindingGroup } from '@/lib/findings';

const LABELS: Record<string, string> = {
  orphan: 'Orphan pages', near_orphan: 'Near-orphan pages', deep_page: 'Pages too deep',
  unreachable_page: 'Unreachable pages', over_optimized_anchor: 'Over-optimized anchors',
  generic_anchor_overuse: 'Generic anchor overuse', under_linked_important: 'Under-linked key pages',
};

// `groups` is computed + capped server-side (see groupAndCapFindings); this is presentation only.
export function FindingsPanel({ groups }: { groups: FindingGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const label = LABELS[g.category] ?? g.category;
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
