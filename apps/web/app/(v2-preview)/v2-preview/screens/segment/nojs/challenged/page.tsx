import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentNoJsChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="nojs" variant="challenged" />;
}
