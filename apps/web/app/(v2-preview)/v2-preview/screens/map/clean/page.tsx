import { previewOnly } from '../../../_preview/guard';
import { MapPreview } from '../../../_preview/MapPreview';

export default function MapCleanPreview() {
  previewOnly();
  return <MapPreview variant="clean" />;
}
