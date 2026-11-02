import { previewOnly } from '../../../_preview/guard';
import { FixPreview } from '../../../_preview/FixPreview';

export default function FixThirdPreview() {
  previewOnly();
  return <FixPreview variant="third" />;
}
