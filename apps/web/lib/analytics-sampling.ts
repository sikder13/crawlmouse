import { FUNNEL_EVENTS } from './analytics-events';

// Cost control #6: keep every funnel event + pageview, sample noisy autocapture/pageleave to
// 10%. `rand` is injected (Math.random in prod) so the decision is deterministic under test.
const ALWAYS_KEEP = new Set<string>([...FUNNEL_EVENTS, '$pageview', '$identify', '$set']);
const SAMPLED = new Set<string>(['$autocapture', '$pageleave', '$rageclick', '$web_vitals']);
export const AUTOCAPTURE_SAMPLE_RATE = 0.1;

export function shouldSendEvent(eventName: string, rand: number): boolean {
  if (ALWAYS_KEEP.has(eventName)) return true;
  if (SAMPLED.has(eventName)) return rand < AUTOCAPTURE_SAMPLE_RATE;
  return true; // unknown custom events kept
}
