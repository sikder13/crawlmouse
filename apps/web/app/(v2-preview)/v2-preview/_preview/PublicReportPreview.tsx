import { PublicReportScreen } from '../../../../components/v2/screens/public-report/PublicReportScreen';
import { fixture } from '../../../../lib/v2/fixtures';
import { buildPublicSnapshot } from '../../../../lib/v2/reports/build-snapshot';
import { CHECKS } from '../../../../lib/v2/recordings';
import { publicReportView } from '../../../../lib/v2/view/public-report';

const FIRST_AUDIT = {
  'bad-site': CHECKS.badFirstAudit,
  'challenged-site': CHECKS.challengedFirstAudit,
} as const;

/** The shared report of a fixture's first audit, minted when that audit finished. */
export function PublicReportPreview({ name }: { name: keyof typeof FIRST_AUDIT }) {
  const d = fixture(name);
  const checkId = FIRST_AUDIT[name];
  const finished = d.checks.find((c) => c.id === checkId)!.finished_at!;
  return <PublicReportScreen view={publicReportView(buildPublicSnapshot(d, checkId, finished))} />;
}
