import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentContentChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="content" variant="challenged" />;
}
