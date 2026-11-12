/**
 * Why a fix has no packet, from the engine's packet registry: the reason its type's entry carries
 * when the engine writes no packet for the type, or null when the type has a builder (the check
 * that last measured the stored fix then wrote none, for a cause the fix does not record:
 * `./no-packet`). Read on the server, where the views are
 * built: the registry is the engine's, and a screen imports `./no-packet` instead.
 */
import { PACKETS } from '@crawlmouse/engine/v2/pipeline';
import type { FixType } from '@crawlmouse/types/v2';

type Entries = Readonly<Record<FixType, { kind: 'none'; reason: string } | { kind: 'builder' }>>;

export function noPacketReason(type: FixType, registry: Entries = PACKETS): string | null {
  const entry = registry[type];
  return entry.kind === 'none' ? entry.reason : null;
}
