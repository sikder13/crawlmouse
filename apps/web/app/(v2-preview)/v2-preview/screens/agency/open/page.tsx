import { MatrixScreen } from '../../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** Acting in a personal account, with a seat on an agency. */
export default function AgencyOpenPreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency/open')} />;
}
