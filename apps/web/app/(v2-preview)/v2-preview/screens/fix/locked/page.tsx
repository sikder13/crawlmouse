import { previewOnly } from '../../../_preview/guard';
import { FixPreview } from '../../../_preview/FixPreview';

export default function FixLockedPreview() {
  previewOnly();
  return <FixPreview variant="locked" />;
}
