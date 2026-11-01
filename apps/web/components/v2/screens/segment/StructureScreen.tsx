/** PLACEHOLDER: replaced by the Structure segment's screen. */
import type { StructureView } from '../../../../lib/v2/view/segment/structure';
import { SegmentShell } from './SegmentShell';

export function StructureScreen({ data }: { data: StructureView }) {
  return (
    <SegmentShell frame={data.frame} keep={null} nextPrimary>
      <p>Structure</p>
    </SegmentShell>
  );
}
