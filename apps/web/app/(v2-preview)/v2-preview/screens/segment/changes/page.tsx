import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentChangesPreview() {
  previewOnly();
  return <SegmentPreview segment="changes" variant="bad-site" />;
}
