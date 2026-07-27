import type { AiReadinessScore, AiPageClass, AiFinding, AiBotAccess } from '@crawlmouse/types';
import type { BadgeTone } from '../ui/Badge';

/** The overall band -> a client-explainable label + a Badge tone. Never a ranking claim (A16). */
export function bandMeta(band: AiReadinessScore['band']): { label: string; tone: BadgeTone } {
  switch (band) {
    case 'ready':
      return { label: 'AI-ready', tone: 'success' };
    case 'partial':
      return { label: 'Partly ready', tone: 'info' };
    case 'at_risk':
      return { label: 'At risk', tone: 'warning' };
    default:
      // Unreachable for a live engine object, but this ALSO reads FROZEN `/r/` report snapshots, which
      // outlive the code that wrote them and can never be migrated (minted-snapshot immutability). With
      // no fallback, renaming a band in a later spec would permanently 500 every already-minted public,
      // indexable report instead of degrading. Mirrors SPEC 04's `findingMeta` fallback on the same artifact.
      return { label: 'Not rated', tone: 'neutral' };
  }
}

/** Per-page AI-legibility class -> label + tone + a plain-language meaning (honest, reachability-framed). */
export function pageClassMeta(cls: AiPageClass): { label: string; tone: BadgeTone; meaning: string } {
  switch (cls) {
    case 'readable':
      return { label: 'Readable', tone: 'success', meaning: 'AI crawlers see this page in full without running JavaScript.' };
    case 'partial':
      return { label: 'Partial', tone: 'info', meaning: 'Only part of this page is in the static HTML; the rest loads with JavaScript.' };
    case 'js_blind':
      return { label: 'JavaScript-blind', tone: 'warning', meaning: 'This page renders with JavaScript, so a non-rendering AI crawler sees an empty page.' };
    case 'thin':
      return { label: 'Thin', tone: 'neutral', meaning: 'This page has very little text — fine for a contact/landing page.' };
  }
}

/** The honesty label rendered next to a finding (§2 evidence discipline). */
export function evidenceLabel(evidence: AiFinding['evidence']): string {
  switch (evidence) {
    case 'strong':
      return 'Strong evidence';
    case 'moderate':
      return 'Moderate evidence';
    case 'contested':
      return 'Contested / mixed evidence';
    case 'informational':
      return 'Informational';
  }
}

export interface ComponentBar {
  key: 'access' | 'content' | 'legibility' | 'retrieval';
  label: string;
  pct: number; // 0..100, rounded at the render boundary
  weight: number;
}

/**
 * The four weighted component sub-scores as render-ready bars (LOCKED weights 25/40/20/15).
 * Takes the `components` block structurally, not a whole `AiReadinessScore`, so the audit page's live
 * engine object and the `/r/` report's frozen snapshot projection can both use it unchanged.
 */
export function componentBars(score: Pick<AiReadinessScore, 'components'>): ComponentBar[] {
  const c = score.components;
  return [
    { key: 'access', label: 'AI crawler access', pct: Math.round(c.access.score * 100), weight: c.access.weight },
    { key: 'content', label: 'Content without JavaScript', pct: Math.round(c.contentWithoutJs.score * 100), weight: c.contentWithoutJs.weight },
    { key: 'legibility', label: 'Machine legibility', pct: Math.round(c.machineLegibility.score * 100), weight: c.machineLegibility.weight },
    { key: 'retrieval', label: 'Retrieval path', pct: Math.round(c.retrievalPath.score * 100), weight: c.retrievalPath.weight },
  ];
}

/** Retrieval-class bots that can't reach the whole site — the scored access story (§3). */
export function blockedRetrievalBots(bots: AiBotAccess[]): AiBotAccess[] {
  return bots.filter((b) => b.botClass === 'retrieval' && b.allowedPageRatio < 1);
}
