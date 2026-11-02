import { previewOnly } from '../../../_preview/guard';
import { FixPreview } from '../../../_preview/FixPreview';

export default function FixChallengedPreview() {
  previewOnly();
  return <FixPreview variant="challenged" />;
}
