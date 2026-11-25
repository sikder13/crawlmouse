import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentLinksPreview() {
  previewOnly();
  return <SegmentPreview segment="links" variant="bad-site" />;
}
