import { AgencyTrialScreen } from '../../../../../../components/v2/screens/agency-trial/AgencyTrialScreen';
import { previewOnly } from '../../../_preview/guard';
import { agencyTrialReturning } from '../../../_preview/pricing';

export default function AgencyTrialReturningPreview() {
  previewOnly();
  return <AgencyTrialScreen view={agencyTrialReturning()} />;
}
