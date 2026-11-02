import { previewOnly } from '../../../_preview/guard';
import { MapPreview } from '../../../_preview/MapPreview';

export default function MapAllPreview() {
  previewOnly();
  return <MapPreview variant="all" />;
}
