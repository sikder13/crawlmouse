import type { ReactNode } from 'react';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { KeptAiReadinessChecker } from '@/app/(v2-kept)/_lib/KeptAiReadinessChecker';
import { ArticleLayout } from '@/components/blog/ArticleLayout';
import { LegalPage } from '@/components/legal/LegalPage';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/**
 * Each page of `KEPT_PREVIEW_INDEX` drawn as its target draws it (app/(v2-kept)/v2-kept), without
 * the target's flag check, which a preview does not need. Each v1 page is imported when its preview
 * is opened, so a preview compiles only its own page.
 */
export const KEPT_RENDERS: Record<string, () => Promise<ReactNode>> = {
  'ai-readiness-checker': async () => <KeptAiReadinessChecker />,
  author: async () =>
    keptPage(await (await import('@/app/authors/[slug]/page')).default(params('udaay-sikder'))),
  blog: async () => keptPage((await import('@/app/blog/page')).default()),
  'blog-research': async () => keptPage((await import('@/app/blog/research/page')).default()),
  'blog-post': async () =>
    keptPage(await (await import('@/app/blog/[slug]/page')).default(params('orphan-pages')), [
      ArticleLayout,
    ]),
  bot: async () => keptPage((await import('@/app/bot/page')).default()),
  guides: async () => keptPage((await import('@/app/guides/page')).default()),
  login: async () => keptPage((await import('@/app/login/page')).default()),
  status: async () => keptPage((await import('@/app/status/page')).default()),
  takedown: async () => keptPage((await import('@/app/takedown/page')).default()),
  privacy: async () => keptPage((await import('@/app/privacy/page')).default(), [LegalPage]),
  terms: async () => keptPage((await import('@/app/terms/page')).default(), [LegalPage]),
  aup: async () => keptPage((await import('@/app/aup/page')).default(), [LegalPage]),
  subprocessors: async () =>
    keptPage((await import('@/app/subprocessors/page')).default(), [LegalPage]),
};
