import type { PacketEntry } from '../types.js';

/**
 * Links that exist only once a page is rendered cannot be found from what the render step keeps
 * (render/page.ts: word counts and a state per page), so the fix type is never opened and has no
 * packet.
 */
export const jsOnlyNavigation: PacketEntry<'js_only_navigation'> = {
  kind: 'none',
  reason:
    'Not measured: the audit’s rendering records word counts only. It keeps no link from the rendered page, so it cannot tell which links exist only once JavaScript has run, and the engine opens no fix of this type.',
};
