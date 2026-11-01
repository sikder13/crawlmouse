import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultEmptyPreview() {
  previewOnly();
  return <ResultPreview name="empty" />;
}
