import { CRAWLER_TOKENS, type Token } from './identities.js';

/**
 * Response signatures (ENGINE-GAP 3.6) and the decision table (ENGINE-GAP 3.5a, R9 closure).
 * Pure: bytes in, verdicts out, so the verdict and the evidence come from the same fetch.
 */

export type Verdict =
  | 'disallowed_by_robots'
  | 'not_measured'
  | 'edge_blocks_automation'
  | 'allowed'
  | 'allowed_thin'
  | 'rate_limited'
  | 'payment_required'
  | 'redirected_away'
  | 'blocked_by_ua_rule'
  | 'challenged_ua'
  | 'refused_unverified';

export type UResult = 'served' | 'refused' | 'challenged' | 'limited' | 'payment' | 'redirected' | 'error' | 'not_fetched';
export type KResult = 'ok' | 'gone' | 'fail';
export type GResult = 'served' | 'refused' | 'challenged' | 'not_run';
export type RobotsVerdict = 'allowed' | 'disallowed';

export interface ResponseShape {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** First bytes of the decoded body; signatures are matched here, never on the full body. */
  bodyHead: string;
  words: number;
  originHost?: string;
  finalHost?: string;
}

const hdr = (h: ResponseShape['headers'], name: string): string => {
  const v = h[name];
  return (Array.isArray(v) ? v.join(',') : v ?? '').toLowerCase();
};

function hasChallengeSignature(r: ResponseShape): boolean {
  if (hdr(r.headers, 'cf-mitigated').includes('challenge')) return true;
  if (hdr(r.headers, 'x-vercel-mitigated').includes('challenge')) return true;
  const b = r.bodyHead.toLowerCase();
  return (
    b.includes('just a moment') ||
    b.includes('challenge-platform') ||
    b.includes('captcha-delivery.com') ||
    b.includes('datadome') ||
    b.includes('px-captcha') ||
    b.includes('perimeterx') ||
    b.includes('incapsula incident') ||
    (b.includes('access denied') && b.includes('reference #') && hdr(r.headers, 'server').includes('akamai'))
  );
}

export function classifyResponse(r: ResponseShape): UResult {
  if (r.status === 0) return 'error';
  if (hasChallengeSignature(r)) return 'challenged';
  if (r.status >= 300 && r.status < 400) return 'redirected';
  if (r.originHost && r.finalHost && r.originHost !== r.finalHost) return 'redirected';
  if (r.status === 402) return 'payment';
  if (r.status === 429 || r.status === 430 || r.bodyHead.includes('error code: 1015')) return 'limited';
  if (r.status === 999) return 'refused';
  if (r.status >= 500) return 'error';
  if (r.status === 200) return 'served';
  if (r.status >= 400) return 'refused'; // 403, 451, 999, 1010/1020 bodies, plain 4xx
  return 'error';
}

/** K from the two controls: browser identity and the Crawlmouse-UA discovery fetch. */
export function classifyControl(controls: ResponseShape[]): KResult {
  if (controls.length > 0 && controls.every((c) => c.status === 404 || c.status === 410)) return 'gone';
  return controls.length > 0 && controls.every((c) => c.status === 200 && !hasChallengeSignature(c)) ? 'ok' : 'fail';
}

export interface CellInput {
  R: RobotsVerdict;
  K: KResult;
  U: UResult;
  W: boolean;
  words: number;
  controlWords: number;
}

export interface Decision {
  verdict: Verdict;
  row: '1' | '2' | '2b' | '3' | '4' | '5' | '6' | '7' | '8';
  scored: boolean;
}

/** Evaluated top to bottom, first match wins. */
export function decide(c: CellInput): Decision {
  if (c.R === 'disallowed') return { verdict: 'disallowed_by_robots', row: '1', scored: true };
  if (c.K === 'gone') return { verdict: 'not_measured', row: '2', scored: false };
  if (c.K === 'fail') return { verdict: 'edge_blocks_automation', row: '2b', scored: false };
  switch (c.U) {
    case 'served':
      return {
        verdict: c.controlWords > 0 && c.words < 0.8 * c.controlWords ? 'allowed_thin' : 'allowed',
        row: '3',
        scored: true,
      };
    case 'limited':
      return { verdict: 'rate_limited', row: '4', scored: false };
    case 'payment':
      return { verdict: 'payment_required', row: '4', scored: false };
    case 'redirected':
      return { verdict: 'redirected_away', row: '4', scored: false };
    case 'error':
    case 'not_fetched':
      return { verdict: 'not_measured', row: '4', scored: false };
    case 'refused':
      return c.W
        ? { verdict: 'blocked_by_ua_rule', row: '5', scored: true }
        : { verdict: 'refused_unverified', row: '8', scored: false };
    case 'challenged':
      return { verdict: 'challenged_ua', row: c.W ? '6' : '7', scored: true };
  }
}

export interface PageObs {
  robots: Record<Token, RobotsVerdict>;
  K: KResult;
  controlWords: number;
  U: Record<Token, UResult>;
  words: Record<Token, number>;
  G: GResult;
}

/** W(p, c): some identity OTHER than c was served on this page (one of the other five, or the tagged Googlebot fetch). */
export function witness(p: PageObs, c: Token): boolean {
  if (p.G === 'served') return true;
  return CRAWLER_TOKENS.some((t) => t !== c && p.U[t] === 'served');
}

export function classifyPage(p: PageObs): Record<Token, Decision> {
  const out = {} as Record<Token, Decision>;
  for (const t of CRAWLER_TOKENS) {
    out[t] = decide({
      R: p.robots[t],
      K: p.K,
      U: p.U[t],
      W: witness(p, t),
      words: p.words[t],
      controlWords: p.controlWords,
    });
  }
  return out;
}

export type SiteSummary = Record<Token, Partial<Record<Verdict, number>>>;

/** Per crawler, how many sampled pages produced each verdict ("challenged on 17 of 20, served on 3"). */
export function summarize(pages: Array<Record<Token, Decision>>): SiteSummary {
  const out = {} as SiteSummary;
  for (const t of CRAWLER_TOKENS) {
    const counts: Partial<Record<Verdict, number>> = {};
    for (const p of pages) counts[p[t].verdict] = (counts[p[t].verdict] ?? 0) + 1;
    out[t] = counts;
  }
  return out;
}

export const gFromU = (u: UResult): GResult => (u === 'served' || u === 'refused' || u === 'challenged' ? u : 'not_run');
