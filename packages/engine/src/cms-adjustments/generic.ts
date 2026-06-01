import { pathExcluder, type CmsAdjustments } from './base.js';

const GENERIC_EXCLUDED = [/^\/login/, /^\/cart/, /^\/checkout/, /^\/account/];

export const genericAdjustments: CmsAdjustments = pathExcluder(GENERIC_EXCLUDED);
