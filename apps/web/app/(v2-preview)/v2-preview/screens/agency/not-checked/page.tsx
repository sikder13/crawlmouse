import { MatrixScreen } from '../../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** A client that has not been checked yet. */
export default function AgencyNotCheckedPreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency/not-checked')} />;
}
