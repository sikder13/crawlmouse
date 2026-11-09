import { TrialEndScreen } from '../../../../../components/v2/screens/trial-end/TrialEndScreen';
import { previewOnly } from '../../_preview/guard';
import { trialEndPreview } from '../../_preview/screens';

export default function TrialEndPreview() {
  previewOnly();
  return <TrialEndScreen data={trialEndPreview()} />;
}
