import { ResultScreen } from '../../../../components/v2/screens/result/ResultScreen';
import { ResultState } from '../../../../components/v2/screens/result/ResultStates';
import { RESULT_PREVIEWS, type ResultPreview as Name } from './screens';

/** One Result preview by name. Each page calls previewOnly() itself before rendering this. */
export function ResultPreview({ name }: { name: Name }) {
  const data = RESULT_PREVIEWS[name]();
  return data.state === 'result' ? <ResultScreen data={data} /> : <ResultState data={data} />;
}
