import { CheckPageScreen } from '../../../../../../components/v2/screens/check/CheckPageScreen';
import { checkPageView } from '../../../../../../lib/v2/view/check-pages';
import { previewOnly } from '../../../_preview/guard';

export default function CheckRobotsAiPreview() {
  previewOnly();
  return <CheckPageScreen data={checkPageView('robots-ai')} />;
}
