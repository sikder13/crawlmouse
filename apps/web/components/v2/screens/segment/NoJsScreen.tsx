/** PLACEHOLDER: replaced by the NoJs segment's screen. */
import type { NoJsView } from '../../../../lib/v2/view/segment/nojs';
import { SegmentShell } from './SegmentShell';

export function NoJsScreen({ data }: { data: NoJsView }) {
  return (
    <SegmentShell frame={data.frame} keep={null} nextPrimary>
      <p>NoJs</p>
    </SegmentShell>
  );
}
