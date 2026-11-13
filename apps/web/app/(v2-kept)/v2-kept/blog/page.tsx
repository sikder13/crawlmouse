import { notFound } from 'next/navigation';
import BlogIndex from '@/app/blog/page';
import { keptPage } from '@/app/(v2-kept)/_lib/KeptShell';
import { checksPublicEnabled } from '@/lib/auth/flags';

export { metadata } from '@/app/blog/page';

/** `/blog` in the v2 shell while V2_CHECKS_PUBLIC is on (CC-36 D3, `V2_REWRITES`); a 404 with it off. */
export default function KeptBlogIndex() {
  if (!checksPublicEnabled()) return notFound();
  return keptPage(BlogIndex());
}
