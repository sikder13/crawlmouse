import { ResultScreen } from '../../../../../components/v2/screens/result/ResultScreen';
import { RESULT_FIXTURE } from '../../_fixtures/result';
import { previewOnly } from '../../_preview/guard';

export default function ResultScreenPreview() {
  previewOnly();
  return <ResultScreen data={RESULT_FIXTURE} />;
}
