import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentSignalsPreview() {
  previewOnly();
  return <SegmentPreview segment="signals" variant="bad-site" />;
}
