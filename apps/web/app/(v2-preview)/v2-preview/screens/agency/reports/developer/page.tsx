import { ClientReportsScreen } from '../../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../../_preview/agency-reports';
import { previewOnly } from '../../../../_preview/guard';

/** Client reports read by a developer: the rows, and no form. */
export default function AgencyReportsDeveloperPreview() {
  previewOnly();
  return (
    <ClientReportsScreen
      data={clientReportsPreview('/v2-preview/screens/agency/reports/developer')}
    />
  );
}
