import { ContinueScreen } from '../../../../../components/v2/screens/continue/ContinueScreen';
import { previewOnly } from '../../_preview/guard';

export default function ContinuePreview() {
  previewOnly();
  return <ContinueScreen state="idle" />;
}
