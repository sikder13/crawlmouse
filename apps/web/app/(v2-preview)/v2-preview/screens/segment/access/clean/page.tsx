import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentAccessCleanPreview() {
  previewOnly();
  return <SegmentPreview segment="access" variant="clean" />;
}
