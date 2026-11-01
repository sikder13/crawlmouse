/** PLACEHOLDER: replaced by the Changes segment's screen. */
import type { ChangesView } from '../../../../lib/v2/view/segment/changes';
import { SegmentShell } from './SegmentShell';

export function ChangesScreen({ data }: { data: ChangesView }) {
  return (
    <SegmentShell frame={data.frame} keep={null} nextPrimary>
      <p>Changes</p>
    </SegmentShell>
  );
}
