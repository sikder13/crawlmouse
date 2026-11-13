import { AgencyTrialScreen } from '../../../../../../components/v2/screens/agency-trial/AgencyTrialScreen';
import { previewOnly } from '../../../_preview/guard';
import { agencyTrialUsed } from '../../../_preview/pricing';

export default function AgencyTrialUsedPreview() {
  previewOnly();
  return <AgencyTrialScreen view={agencyTrialUsed()} />;
}
