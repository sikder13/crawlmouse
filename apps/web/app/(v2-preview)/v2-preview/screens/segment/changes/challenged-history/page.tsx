import { previewOnly } from '../../../../_preview/guard';
import { ChangesHistoryPreview } from '../../../../_preview/SegmentPreview';

export default function SegmentChangesChallengedHistoryPreview() {
  previewOnly();
  return <ChangesHistoryPreview name="challenged-history" />;
}
