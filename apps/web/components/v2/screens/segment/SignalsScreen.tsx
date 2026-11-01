/** PLACEHOLDER: replaced by the Signals segment's screen. */
import type { SignalsView } from '../../../../lib/v2/view/segment/signals';
import { SegmentShell } from './SegmentShell';

export function SignalsScreen({ data }: { data: SignalsView }) {
  return (
    <SegmentShell frame={data.frame} keep={null} nextPrimary>
      <p>Signals</p>
    </SegmentShell>
  );
}
