import { MatrixScreen } from '../../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** A client whose first check is queued. */
export default function AgencyFirstCheckPreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency/first-check')} />;
}
