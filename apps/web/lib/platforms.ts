// The CMS platforms with public leaderboards at /top/<platform>. Single source of truth shared by
// the leaderboard route (validation + static params) and the sitemap, so they can't drift apart.
export const PLATFORMS = [
  'shopify',
  'wordpress',
  'webflow',
  'wix',
  'squarespace',
  'framer',
  'ghost',
  'custom',
] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}
