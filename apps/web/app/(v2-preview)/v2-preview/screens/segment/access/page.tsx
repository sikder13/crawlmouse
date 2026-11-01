import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentAccessPreview() {
  previewOnly();
  return <SegmentPreview segment="access" variant="bad-site" />;
}
