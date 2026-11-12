import { AgencyTrialScreen } from '../../../../../../components/v2/screens/agency-trial/AgencyTrialScreen';
import { previewOnly } from '../../../_preview/guard';
import { agencyTrialHeld } from '../../../_preview/pricing';

export default function AgencyTrialHeldPreview() {
  previewOnly();
  return <AgencyTrialScreen view={agencyTrialHeld()} />;
}
