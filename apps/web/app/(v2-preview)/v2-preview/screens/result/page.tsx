import { previewOnly } from '../../_preview/guard';
import { ResultPreview } from '../../_preview/ResultPreview';

export default function ResultScreenPreview() {
  previewOnly();
  return <ResultPreview name="bad-site" />;
}
