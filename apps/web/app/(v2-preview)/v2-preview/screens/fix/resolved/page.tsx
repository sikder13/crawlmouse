import { previewOnly } from '../../../_preview/guard';
import { FixPreview } from '../../../_preview/FixPreview';

export default function FixResolvedPreview() {
  previewOnly();
  return <FixPreview variant="resolved" />;
}
