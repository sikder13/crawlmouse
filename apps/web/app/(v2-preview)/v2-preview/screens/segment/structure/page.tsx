import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentStructurePreview() {
  previewOnly();
  return <SegmentPreview segment="structure" variant="bad-site" />;
}
