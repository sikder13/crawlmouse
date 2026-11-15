import Link from 'next/link';
import type { Route } from 'next';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { checksExplainedBy, clusterHub, clusterOf, relatedPosts } from '@/lib/blog/clusters';
import { CHECK_COPY, checkPath } from '@/lib/v2/copy/check-pages';

/**
 * A post's place in its topic cluster (CC-40 D6): two or three related posts by their titles, the
 * /check pages it explains, and its cluster on /guides. The /check pages answer only while
 * V2_CHECKS_PUBLIC is on, so they are linked only then. A post in no cluster renders nothing.
 */
export function ClusterLinks({ slug }: { slug: string }) {
  const cluster = clusterOf(slug);
  if (!cluster) return null;
  const checks = checksPublicEnabled() ? checksExplainedBy(slug) : [];
  return (
    <nav aria-label="More on this topic" className="cluster-links mt-16">
      <h2 className="font-display font-semibold text-xl text-ink mb-4">Related guides</h2>
      <ul className="space-y-3">
        {relatedPosts(slug).map((p) => (
          <li key={p.slug}>
            <Link
              href={`/blog/${p.slug}` as Route}
              className="text-peach hover:underline font-medium"
            >
              {p.title}
            </Link>
          </li>
        ))}
        {checks.map((q) => (
          <li key={q}>
            <Link href={checkPath(q) as Route} className="text-peach hover:underline font-medium">
              {CHECK_COPY[q].h1}
            </Link>{' '}
            <span className="text-ink/60 text-sm">A free check</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm">
        <Link href={clusterHub(cluster) as Route} className="text-ink/70 hover:text-peach">
          All guides in “{cluster.title}”
        </Link>
      </p>
    </nav>
  );
}
