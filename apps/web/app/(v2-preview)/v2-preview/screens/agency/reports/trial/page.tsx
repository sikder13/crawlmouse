import { ClientReportsScreen } from '../../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../../_preview/agency-reports';
import { previewOnly } from '../../../../_preview/guard';

/** Client reports of an account in its Agency trial. */
export default function AgencyReportsTrialPreview() {
  previewOnly();
  return (
    <ClientReportsScreen data={clientReportsPreview('/v2-preview/screens/agency/reports/trial')} />
  );
}
