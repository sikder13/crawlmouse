import { previewOnly } from '../../_preview/guard';
import { FixPreview } from '../../_preview/FixPreview';

export default function FixPreviewPage() {
  previewOnly();
  return <FixPreview variant="bad-site" />;
}
