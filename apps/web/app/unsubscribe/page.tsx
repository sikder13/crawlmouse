import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { UNSUBSCRIBE_COPY, unsubscribePageView } from '@/lib/v2/mail/unsubscribe';

// The link's token is in this page's URL: no index, and no Referer carries it on.
export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * Where an alert or summary email's footer link lands (CC-28 D7). Works signed out. It reads the
 * token and shows the choice; only the form's POST to /api/unsubscribe changes anything. A 404 until
 * V2_CHECKS_PUBLIC=1.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const q = await searchParams;
  const view = unsubscribePageView(
    { t: one(q.t), done: one(q.done), error: one(q.error) },
    process.env,
    new Date(),
  );
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-4 text-2xl font-semibold">{UNSUBSCRIBE_COPY.title}</h1>
      <p className="mb-6">{view.text}</p>
      {view.state === 'ask' && (
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="t" value={view.token} />
          <button type="submit" className="rounded bg-orange-600 px-4 py-2 font-medium text-white">
            {UNSUBSCRIBE_COPY.button}
          </button>
        </form>
      )}
    </main>
  );
}
