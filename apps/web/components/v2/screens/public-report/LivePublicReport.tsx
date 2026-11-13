import '../../../../styles/v2/tokens.css';
import { ReferralCapture } from '@/components/analytics/ReferralCapture';
import type { PublicReportView } from '../../../../lib/v2/view/public-report';
import { PublicReportScreen } from './PublicReportScreen';
import { ReportViewBeacon } from './ReportViewBeacon';

/**
 * The shared v2 report as `/r/<slug>` serves it: the screen with its audit form starting a real
 * audit, v1's referral capture (a shared link carries `?ref=`), and the view beacon.
 */
export function LivePublicReport({ slug, view }: { slug: string; view: PublicReportView }) {
  return (
    <>
      <ReferralCapture />
      <ReportViewBeacon slug={slug} />
      <PublicReportScreen view={view} start />
    </>
  );
}
