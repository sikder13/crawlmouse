import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { UrlForm } from '@/components/audit/UrlForm';
import { AiReadinessCheckerLd, AiReadinessCheckerMain } from './AiReadinessChecker';

export { metadata } from './AiReadinessChecker';

// The content lives in AiReadinessChecker.tsx so the page's v2 target (app/(v2-kept)) can render it
// with v2's audit form without importing v1's, which posts to a route the cutover retires.
export default function AiReadinessCheckerPage() {
  return (
    <>
      <AiReadinessCheckerLd />
      <Header />
      {/* The homepage's audit input, imported unchanged: submitting here behaves exactly as it
          does on the homepage. */}
      <AiReadinessCheckerMain form={<UrlForm resultView="ai" />} />
      <Footer />
    </>
  );
}
