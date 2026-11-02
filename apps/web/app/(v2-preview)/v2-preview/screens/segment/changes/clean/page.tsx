import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentChangesCleanPreview() {
  previewOnly();
  return <SegmentPreview segment="changes" variant="clean" />;
}
