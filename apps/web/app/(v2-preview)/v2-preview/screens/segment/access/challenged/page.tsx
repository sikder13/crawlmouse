import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentAccessChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="access" variant="challenged" />;
}
