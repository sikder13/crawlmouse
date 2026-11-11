import { FirstCheckScreen } from '../../../../../../components/v2/screens/site/FirstCheckScreen';
import { previewOnly } from '../../../_preview/guard';
import { firstCheckPreview } from '../../../_preview/accounts';

export default function SiteFirstCheckPreview() {
  previewOnly();
  return <FirstCheckScreen data={firstCheckPreview()} />;
}
