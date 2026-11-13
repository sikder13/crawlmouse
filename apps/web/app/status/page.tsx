import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Card } from '@/components/ui/Card';
import { SUPPORT_EMAIL } from '@/components/v2/footer-links';
import { ANSWERING, healthReport } from '@/lib/v2/ops/health';

export const metadata = {
  title: 'Status',
  alternates: { canonical: '/status' },
};

// Rendered on each request by the deployment serving it, so the page answering is the one state it
// reports. Nothing else here is measured, and the page says so.
export const dynamic = 'force-dynamic';

export default function StatusPage() {
  const report = healthReport();
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto px-6 pt-20 pb-32">
        <h1 className="font-display font-bold text-5xl tracking-tight">Crawlmouse status</h1>
        <p className="mt-4 text-lg text-ink/70">
          This page shows what it measures, and says what it does not.
        </p>

        <Card className="mt-10">
          <div data-status-measured="website">
            <p className="font-display font-bold text-lg text-ink">Website: {ANSWERING}</p>
            <p className="mt-2 text-sm text-ink/60">
              This page was rendered by the deployment serving crawlmouse.com when you loaded it:
              version {report.version},{' '}
              {report.commit === null ? 'commit not known' : `commit ${report.commit}`}.
            </p>
          </div>
        </Card>

        <Card className="mt-6 bg-peach/10 border-peach/40">
          <p className="text-ink/80 leading-relaxed">
            Audits, email and billing are not monitored on this page.
          </p>
        </Card>

        <p className="mt-6 text-sm text-ink/60">
          If something looks wrong, email{' '}
          <a className="text-peach underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </main>
      <Footer />
    </>
  );
}
