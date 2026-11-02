import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentContentPreview() {
  previewOnly();
  return <SegmentPreview segment="content" variant="bad-site" />;
}
