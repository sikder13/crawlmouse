// The seven launch funnel events. Keep this list and the call sites in sync; it also drives
// the sampling allow-list so a funnel event is never dropped.
export const FUNNEL_EVENTS = [
  'landing-view',
  'audit-submitted',
  'audit-completed',
  'email-captured',
  'public-share-clicked',
  'csv-download',
  'pro-upgrade',
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
