import { pathExcluder, type CmsAdjustments } from './base.js';

const WP_EXCLUDED = [
  /^\/wp-admin/,
  /^\/wp-login/,
  /^\/wp-json/,
  /^\/feed/,
  /^\/category\//,
  /^\/tag\//,
  /^\/author\//,
];

export const wordpressAdjustments: CmsAdjustments = pathExcluder(WP_EXCLUDED);
