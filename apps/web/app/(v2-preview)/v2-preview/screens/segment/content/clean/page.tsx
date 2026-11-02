import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentContentCleanPreview() {
  previewOnly();
  return <SegmentPreview segment="content" variant="clean" />;
}
