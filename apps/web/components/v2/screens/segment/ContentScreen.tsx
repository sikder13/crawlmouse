/** PLACEHOLDER: replaced by the Content segment's screen. */
import type { ContentView } from '../../../../lib/v2/view/segment/content';
import { SegmentShell } from './SegmentShell';

export function ContentScreen({ data }: { data: ContentView }) {
  return (
    <SegmentShell frame={data.frame} keep={null} nextPrimary>
      <p>Content</p>
    </SegmentShell>
  );
}
