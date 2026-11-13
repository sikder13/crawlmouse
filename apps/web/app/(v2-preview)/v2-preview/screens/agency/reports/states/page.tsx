import { ClientReportsScreen } from '../../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../../_preview/agency-reports';
import { previewOnly } from '../../../../_preview/guard';

/** A client in each state of its contact and its schedule. */
export default function AgencyReportsStatesPreview() {
  previewOnly();
  return (
    <ClientReportsScreen data={clientReportsPreview('/v2-preview/screens/agency/reports/states')} />
  );
}
