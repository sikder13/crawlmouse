import type { CmsAdjustments } from './index.js';

const GENERIC_EXCLUDED = [/^\/login/, /^\/cart/, /^\/checkout/, /^\/account/];

export const genericAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return GENERIC_EXCLUDED.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
