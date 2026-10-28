import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultExpiredPreview() {
  previewOnly();
  return <ResultPreview name="expired" />;
}
