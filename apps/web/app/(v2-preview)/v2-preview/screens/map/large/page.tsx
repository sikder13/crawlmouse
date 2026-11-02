import { previewOnly } from '../../../_preview/guard';
import { MapPreview } from '../../../_preview/MapPreview';

export default function MapLargePreview() {
  previewOnly();
  return <MapPreview variant="large" />;
}
