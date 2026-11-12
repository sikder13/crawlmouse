import type { PacketEntry } from '../types.js';

/**
 * Links that exist only once a page is rendered cannot be found from what the render step keeps
 * (render/page.ts: word counts and a state per page), so the fix type is never opened and has no
 * packet.
 */
export const jsOnlyNavigation: PacketEntry<'js_only_navigation'> = {
  kind: 'none',
  reason:
    'Not measured: the render step records word counts only. No link of the rendered side is kept, and js_only is written false on every page and edge, so the engine opens no fix of this type.',
};
