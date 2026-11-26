/**
 * D-17: the Account card's time zone field. Its options are the names `PATCH /api/account` accepts
 * (`ZONES`, from this runtime's ICU), so the select cannot post one the save refuses. An account's
 * stored zone may be a name outside that list (sign-up stores any zone the browser names); the field
 * shows it as its canonical name, the same zone, because a select whose value is not among its
 * options posts its first one.
 */
import { ZONES } from '../account/profile';

export interface ZoneOption {
  value: string;
  label: string;
}

/** UTC first, then the rest in order, each labelled without underscores. */
export const ZONE_OPTIONS: readonly ZoneOption[] = [
  'UTC',
  ...[...ZONES].filter((z) => z !== 'UTC').sort(),
].map((value) => ({ value, label: value.replace(/_/g, ' ') }));

/** The listed name for `zone` (itself, or ICU's canonical name for it); null if neither is listed. */
export function listedZone(zone: string): string | null {
  if (ZONES.has(zone)) return zone;
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
      .timeZone;
    return ZONES.has(canonical) ? canonical : null;
  } catch {
    return null;
  }
}
