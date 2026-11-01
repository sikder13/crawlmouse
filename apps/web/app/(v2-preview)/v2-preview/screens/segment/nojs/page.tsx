import { previewOnly } from '../../../_preview/guard';
import { SegmentPreview } from '../../../_preview/SegmentPreview';

export default function SegmentNoJsPreview() {
  previewOnly();
  return <SegmentPreview segment="nojs" variant="bad-site" />;
}
