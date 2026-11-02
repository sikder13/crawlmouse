import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentSignalsChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="signals" variant="challenged" />;
}
