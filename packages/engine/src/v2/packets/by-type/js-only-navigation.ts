import type { PacketEntry } from '../types.js';

/**
 * The JS-only navigation fix opens from the links the render step reads on both sides of a page
 * (render/links.ts, detectors/js-only-navigation.ts). No packet is written for it yet: its effort and
 * its before and after are not written either (effort.ts, before-after.ts), and the fix page shows a
 * fix without a packet as such (CC-32 Q7).
 */
export const jsOnlyNavigation: PacketEntry<'js_only_navigation'> = {
  kind: 'none',
  reason:
    'No packet yet: the audit finds these links by reading each sampled page before and after its JavaScript runs, and the steps to put them in the HTML are not written for any stack yet.',
};
