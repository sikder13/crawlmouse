import { HelpIndexScreen } from '../../../../../components/v2/screens/help/HelpScreens';
import { helpIndexView } from '../../../../../lib/v2/help/view';
import { previewOnly } from '../../_preview/guard';

export default function HelpPreview() {
  previewOnly();
  return <HelpIndexScreen data={helpIndexView()} />;
}
