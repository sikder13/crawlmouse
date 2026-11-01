import { previewOnly } from '../../_preview/guard';
import { MapPreview } from '../../_preview/MapPreview';

export default function MapHubsPreview() {
  previewOnly();
  return <MapPreview variant="bad-site" />;
}
