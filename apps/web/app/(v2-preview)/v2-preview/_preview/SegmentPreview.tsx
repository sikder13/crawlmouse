import { AccessScreen } from '../../../../components/v2/screens/segment/AccessScreen';
import { ChangesScreen } from '../../../../components/v2/screens/segment/ChangesScreen';
import { ContentScreen } from '../../../../components/v2/screens/segment/ContentScreen';
import { NoJsScreen } from '../../../../components/v2/screens/segment/NoJsScreen';
import { SignalsScreen } from '../../../../components/v2/screens/segment/SignalsScreen';
import { StructureScreen } from '../../../../components/v2/screens/segment/StructureScreen';
import type { SegmentKey } from '../../../../lib/v2/view/segment/frame';
import {
  SEGMENT_PREVIEWS,
  changesHistoryPreview,
  type ChangesHistory,
  type SegmentVariant,
} from './segments';

/** One segment preview by key and variant. Each page calls previewOnly() itself before this. */
export function SegmentPreview({
  segment,
  variant,
}: {
  segment: SegmentKey;
  variant: SegmentVariant;
}) {
  switch (segment) {
    case 'access':
      return <AccessScreen data={SEGMENT_PREVIEWS.access(variant)} />;
    case 'nojs':
      return <NoJsScreen data={SEGMENT_PREVIEWS.nojs(variant)} />;
    case 'structure':
      return <StructureScreen data={SEGMENT_PREVIEWS.structure(variant)} />;
    case 'content':
      return <ContentScreen data={SEGMENT_PREVIEWS.content(variant)} />;
    case 'signals':
      return <SignalsScreen data={SEGMENT_PREVIEWS.signals(variant)} />;
    case 'changes':
      return <ChangesScreen data={SEGMENT_PREVIEWS.changes(variant)} />;
  }
}

/** The Changes page of a later check. */
export function ChangesHistoryPreview({ name }: { name: ChangesHistory }) {
  return <ChangesScreen data={changesHistoryPreview(name)} />;
}
