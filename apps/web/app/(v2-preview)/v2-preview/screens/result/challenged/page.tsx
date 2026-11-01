import { previewOnly } from '../../../_preview/guard';
import { ResultPreview } from '../../../_preview/ResultPreview';

export default function ResultChallengedPreview() {
  previewOnly();
  return <ResultPreview name="challenged" />;
}
