/**
 * A fix the reader may open that has no packet: the sentence the fix page and a segment's open fix
 * say in the packet's place, and the rule for where a segment's orange element goes. This module
 * imports types only (`app/audit/[id]/audit-routes.test.tsx` reads its imports), so a screen can
 * import it. The reason comes from the engine's packet registry, read on the server
 * (`./packet-reason`).
 */
import type { OpenFixView } from './segment/fixes';

/** Said of a fix whose type has a packet builder, when the stored fix holds no packet. */
export const NOT_WRITTEN_BY_CHECK =
  'The check that last measured this fix wrote no steps for it. The next check that finds it writes them.';

/** Said before the engine's reason, of a fix type the engine writes no packet for. */
export const NO_STEPS_FOR_TYPE = 'The audit writes no steps for this kind of fix.';

/** What every such line ends with. */
export const FOUND_ABOVE = 'What the audit found is above.';

/**
 * The line in the packet's place. `reason` is the engine's for the fix's type (a sentence), or
 * null when the type has a builder and this fix was stored without a packet.
 */
export const noPacketLine = (reason: string | null): string =>
  reason === null
    ? `${NOT_WRITTEN_BY_CHECK} ${FOUND_ABOVE}`
    : `${NO_STEPS_FOR_TYPE} ${reason} ${FOUND_ABOVE}`;

/**
 * Whether one of a section's open fixes has a packet to copy. The first such fix's copy button is
 * the page's orange element; where there is none, the screen gives the orange to its next step.
 */
export const hasPacketToCopy = (fixes: { open: readonly Pick<OpenFixView, 'packet'>[] }) =>
  fixes.open.some((f) => f.packet !== null);
