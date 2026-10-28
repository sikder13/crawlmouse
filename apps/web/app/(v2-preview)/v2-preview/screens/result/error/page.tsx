import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultErrorPreview() {
  previewOnly();
  return <ResultPreview name="error" />;
}
