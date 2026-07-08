import type { PublicReportSnapshot, FindingCategory } from '@crawlmouse/types';
import { findingMeta } from '@/components/audit/finding-meta';

// SPEC 04 §4 — the client-ready report's DETERMINISTIC, template-assembled content (no LLM, D3).
// Pure: same snapshot → byte-identical output. Honesty (§11): sells the GRADE + discoverability,
// never rankings/traffic. Every string here is rendered as plain React text (no raw HTML).

const round = (n: number): number => Math.round(n);

/** A lowercase, count-aware noun phrase for an issue, e.g. "5 orphan pages". */
function issuePhrase(label: string, count: number): string {
  const noun = label.toLowerCase();
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The 3–5 sentence executive summary. Deterministic template from the frozen snapshot: grade line,
 * coverage/confidence line, the top issues (headline orphan count + the next finding categories), and
 * — when a projection exists — the achievable grade framed as a GRADE gain (never traffic).
 */
export function buildExecutiveSummary(s: PublicReportSnapshot): string[] {
  const out: string[] = [];

  // S1 — grade, score, domain.
  out.push(`${s.domain} scored ${s.grade} (${round(s.score)}/100) for internal linking.`);

  // S2 — coverage + confidence (honest; low confidence reads as an estimate).
  if (s.confidence === 'low') {
    out.push(
      `This grade is a partial estimate — we could only reach part of the site, so treat it as a starting point.`,
    );
  } else {
    const ofM = s.estimatedTotal != null ? ` of an estimated ${s.estimatedTotal}` : '';
    out.push(`It reflects the ${s.pageCount}${ofM} pages we crawled.`);
  }

  // S3 — the biggest issues, or an honest positive when the site is clean. Orphans use the true
  // headline count; other categories use their finding counts. Sorted by count desc (deterministic).
  const issues: Array<{ phrase: string; count: number }> = [];
  if (s.orphanCount > 0) issues.push({ phrase: issuePhrase(findingMeta('orphan').label, s.orphanCount), count: s.orphanCount });
  const perCat = new Map<string, number>();
  for (const f of s.findings) {
    if (f.category === 'orphan') continue; // headline-counted above
    perCat.set(f.category, (perCat.get(f.category) ?? 0) + 1);
  }
  for (const [cat, count] of perCat) issues.push({ phrase: issuePhrase(findingMeta(cat).label, count), count });
  issues.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
  if (issues.length === 0) {
    out.push(`No structural internal-linking issues stood out — the site’s internal linking is in good shape.`);
  } else {
    const top = issues.slice(0, 3).map((i) => i.phrase);
    const list = top.length === 1 ? top[0] : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`;
    out.push(`The biggest issues are ${list}.`);
  }

  // S4 — the achievable grade (only when a projection exists), framed as a GRADE gain.
  if (s.projected && s.projected.grade !== s.grade) {
    out.push(`Addressing the prioritised fixes below could lift the grade toward ${s.projected.grade}.`);
  }

  return out;
}

export interface FindingSummaryGroup {
  category: FindingCategory;
  label: string;
  what: string;
  why: string;
  count: number;
}

/**
 * Group the snapshot's findings by category with the plain-language meta + a count, ordered by count
 * desc (tiebreak: category asc) so the render is deterministic.
 */
export function summarizeFindings(s: PublicReportSnapshot): FindingSummaryGroup[] {
  const counts = new Map<string, number>();
  for (const f of s.findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => {
      const meta = findingMeta(category);
      return { category: category as FindingCategory, label: meta.label, what: meta.what, why: meta.why, count };
    });
}

/**
 * The methodology paragraph: honest static-HTML framing + the "N of ~M pages" coverage + confidence.
 * Omits "~M" when no estimate is derivable (never invents a total).
 */
export function buildMethodology(s: PublicReportSnapshot): string {
  const ofM = s.estimatedTotal != null ? ` of an estimated ${s.estimatedTotal}` : '';
  const conf = s.confidence ? `, at ${s.confidence} confidence` : '';
  return (
    `This is a deterministic analysis of ${s.domain}’s publicly served HTML — the same static view that ` +
    `non-JavaScript AI crawlers see. It is based on the ${s.pageCount}${ofM} pages we could crawl${conf}. ` +
    `The grade blends four signals from the internal-link graph: orphan pages, click depth, anchor-text ` +
    `diversity, and hub structure.`
  );
}
