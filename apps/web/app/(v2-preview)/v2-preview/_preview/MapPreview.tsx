import { ExplorerScreen } from '../../../../components/v2/screens/map/ExplorerScreen';
import { mapPreview, type MapVariant } from './maps';

/** One explorer preview by variant. Each page calls previewOnly() itself before rendering this. */
export function MapPreview({ variant }: { variant: MapVariant }) {
  return <ExplorerScreen data={mapPreview(variant)} />;
}
