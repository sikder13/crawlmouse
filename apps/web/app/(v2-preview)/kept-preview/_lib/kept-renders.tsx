import type { ReactNode } from 'react';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { legalPage } from '@/app/(v2-kept)/_lib/LegalShell';
import { KeptAiReadinessChecker } from '@/app/(v2-kept)/_lib/KeptAiReadinessChecker';
import { ArticleLayout } from '@/components/blog/ArticleLayout';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/**
 * Each page of `KEPT_PREVIEW_INDEX` drawn as its target draws it (app/(v2-kept)/v2-kept), without
 * the target's flag check, which a preview does not need. Each v1 page is imported when its preview
 * is opened, so a preview compiles only its own page.
 */
export const KEPT_RENDERS: Record<string, () => Promise<ReactNode>> = {
  'ai-readiness-checker': async () => <KeptAiReadinessChecker />,
  author: async () =>
    keptPage(
      await (await import('@/app/authors/[slug]/page')).default(params('udaay-sikder')),
      [],
      'v2',
    ),
  blog: async () => keptPage((await import('@/app/blog/page')).default(), [], 'v2'),
  'blog-research': async () =>
    keptPage((await import('@/app/blog/research/page')).default(), [], 'v2'),
  'blog-post': async () =>
    keptPage(
      await (await import('@/app/blog/[slug]/page')).default(params('orphan-pages')),
      [ArticleLayout],
      'v2',
    ),
  bot: async () => keptPage((await import('@/app/bot/page')).default()),
  guides: async () => keptPage((await import('@/app/guides/page')).default(), [], 'v2'),
  login: async () => keptPage((await import('@/app/login/page')).default()),
  status: async () => keptPage((await import('@/app/status/page')).default()),
  takedown: async () => legalPage((await import('@/app/takedown/page')).default()),
  privacy: async () => legalPage((await import('@/app/privacy/page')).default()),
  terms: async () => legalPage((await import('@/app/terms/page')).default()),
  aup: async () => legalPage((await import('@/app/aup/page')).default()),
  subprocessors: async () => legalPage((await import('@/app/subprocessors/page')).default()),
};
