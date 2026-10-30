import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultCleanPreview() {
  previewOnly();
  return <ResultPreview name="clean" />;
}
