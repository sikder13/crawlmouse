import { previewOnly } from '../../../../_preview/guard';
import { ChangesHistoryPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentChangesHistoryPreview() {
  previewOnly();
  return <ChangesHistoryPreview name="history" />;
}
