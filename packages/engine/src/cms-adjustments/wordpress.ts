import type { CmsAdjustments } from './index.js';

const WP_EXCLUDED = [
  /^\/wp-admin/,
  /^\/wp-login/,
  /^\/wp-json/,
  /^\/feed/,
  /^\/category\//,
  /^\/tag\//,
  /^\/author\//,
];

export const wordpressAdjustments: CmsAdjustments = {
  excludeFromOrphans(url: string) {
    try {
      const u = new URL(url);
      return WP_EXCLUDED.some((p) => p.test(u.pathname));
    } catch {
      return false;
    }
  },
};
