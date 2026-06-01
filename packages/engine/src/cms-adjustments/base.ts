export interface CmsAdjustments {
  excludeFromOrphans: (url: string) => boolean;
}

/**
 * Builds a CmsAdjustments whose excludeFromOrphans matches a URL's pathname
 * against a set of patterns. Shared by every CMS profile so the URL-parse +
 * try/catch is written once rather than copy-pasted per platform. Lives in its
 * own leaf module to avoid a cycle with index.ts (which imports the profiles).
 */
export function pathExcluder(patterns: RegExp[]): CmsAdjustments {
  return {
    excludeFromOrphans(url: string): boolean {
      try {
        const { pathname } = new URL(url);
        return patterns.some((p) => p.test(pathname));
      } catch {
        return false;
      }
    },
  };
}
