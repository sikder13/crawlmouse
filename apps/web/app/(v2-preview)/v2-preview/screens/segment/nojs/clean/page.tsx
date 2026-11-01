import { previewOnly } from '../../../../_preview/guard';
import { SegmentPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentNoJsCleanPreview() {
  previewOnly();
  return <SegmentPreview segment="nojs" variant="clean" />;
}
