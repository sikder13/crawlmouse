import { previewOnly } from '../../../_preview/guard';
import { FixPreview } from '../../../_preview/FixPreview';

export default function FixFirstPreview() {
  previewOnly();
  return <FixPreview variant="first" />;
}
