import { ClientReportsScreen } from '../../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../../_preview/agency-reports';
import { previewOnly } from '../../../../_preview/guard';

/** Client reports on an account below Agency: the gate. */
export default function AgencyReportsGatePreview() {
  previewOnly();
  return (
    <ClientReportsScreen data={clientReportsPreview('/v2-preview/screens/agency/reports/gate')} />
  );
}
