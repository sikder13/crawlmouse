import { previewOnly } from '../../../../_preview/guard';
import { LinksBuiltPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentLinksBuiltPreview() {
  previewOnly();
  return <LinksBuiltPreview />;
}
