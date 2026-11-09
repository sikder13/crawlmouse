import { SiteScreen } from '../../../../../../components/v2/screens/site/SiteScreen';
import { previewOnly } from '../../../_preview/guard';
import { shellPreview, sitePreview } from '../../../_preview/accounts';

export default function SiteWithheldPreview() {
  previewOnly();
  return <SiteScreen data={sitePreview('withheld')} shell={shellPreview('withheld')} />;
}
