import { ContinueScreen } from '../../../../../../components/v2/screens/continue/ContinueScreen';
import { previewOnly } from '../../../_preview/guard';

export default function ContinueExpiredPreview() {
  previewOnly();
  return <ContinueScreen state="expired" />;
}
