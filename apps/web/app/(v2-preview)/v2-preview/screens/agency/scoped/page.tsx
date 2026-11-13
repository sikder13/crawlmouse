import { MatrixScreen } from '../../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** A seat that covers one client. */
export default function AgencyScopedPreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency/scoped')} />;
}
