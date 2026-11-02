import { previewOnly } from '../../../_preview/guard';
import { MapPreview } from '../../../_preview/MapPreview';

export default function MapChallengedPreview() {
  previewOnly();
  return <MapPreview variant="challenged" />;
}
