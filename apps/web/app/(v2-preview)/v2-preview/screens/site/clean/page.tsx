import { SiteScreen } from '../../../../../../components/v2/screens/site/SiteScreen';
import { previewOnly } from '../../../_preview/guard';
import { shellPreview, sitePreview } from '../../../_preview/accounts';

export default function SiteCleanPreview() {
  previewOnly();
  return <SiteScreen data={sitePreview('clean')} shell={shellPreview('clean')} />;
}
