/**
 * A fix the reader may open whose steps the audit did not write (a fix with no packet): the one
 * sentence the fix page and a segment's open fix say in the packet's place, and the rule for where
 * a segment's orange element goes. This module imports types only, so a screen can import it.
 */
import type { OpenFixView } from './segment/fixes';

export const NO_PACKET =
  'The steps for this fix are not written yet. What the audit found, and its estimated effect, are above.';

/**
 * Whether one of a section's open fixes has a packet to copy. The first such fix's copy button is
 * the page's orange element; where there is none, the screen gives the orange to its next step.
 */
export const hasPacketToCopy = (fixes: { open: readonly Pick<OpenFixView, 'packet'>[] }) =>
  fixes.open.some((f) => f.packet !== null);
