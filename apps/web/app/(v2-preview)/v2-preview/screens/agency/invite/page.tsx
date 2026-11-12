import { MatrixScreen } from '../../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../../_preview/agency';
import { previewOnly } from '../../../_preview/guard';

/** A first check done and one seat: invite a colleague. */
export default function AgencyInvitePreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency/invite')} />;
}
