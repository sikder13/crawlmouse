import { ClientReportsScreen } from '../../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../../_preview/agency-reports';
import { previewOnly } from '../../../../_preview/guard';

/** One client’s forms, open. */
export default function AgencyReportsChangePreview() {
  previewOnly();
  return (
    <ClientReportsScreen data={clientReportsPreview('/v2-preview/screens/agency/reports/change')} />
  );
}
