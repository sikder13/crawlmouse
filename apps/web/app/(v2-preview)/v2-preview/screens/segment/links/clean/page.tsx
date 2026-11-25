import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentLinksCleanPreview() {
  previewOnly();
  return <SegmentPreview segment="links" variant="clean" />;
}
