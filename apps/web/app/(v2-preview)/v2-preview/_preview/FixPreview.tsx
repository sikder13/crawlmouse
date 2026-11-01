import { FixScreen } from '../../../../components/v2/screens/fix/FixScreen';
import { fixPreview, type FixVariant } from './fixes';

/** One fix-page preview by variant. Each page calls previewOnly() itself before rendering this. */
export function FixPreview({ variant }: { variant: FixVariant }) {
  return <FixScreen data={fixPreview(variant)} />;
}
