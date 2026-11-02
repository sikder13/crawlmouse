import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentStructureChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="structure" variant="challenged" />;
}
