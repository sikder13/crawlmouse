import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentChangesChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="changes" variant="challenged" />;
}
