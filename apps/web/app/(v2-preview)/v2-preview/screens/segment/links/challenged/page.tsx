import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentLinksChallengedPreview() {
  previewOnly();
  return <SegmentPreview segment="links" variant="challenged" />;
}
