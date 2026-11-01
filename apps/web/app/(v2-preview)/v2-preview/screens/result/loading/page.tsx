import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultLoadingPreview() {
  previewOnly();
  return <ResultPreview name="loading" />;
}
