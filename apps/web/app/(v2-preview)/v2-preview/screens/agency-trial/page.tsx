import { AgencyTrialScreen } from '../../../../../components/v2/screens/agency-trial/AgencyTrialScreen';
import { previewOnly } from '../../_preview/guard';
import { agencyTrialNew } from '../../_preview/pricing';

export default function AgencyTrialPreview() {
  previewOnly();
  return <AgencyTrialScreen view={agencyTrialNew()} />;
}
