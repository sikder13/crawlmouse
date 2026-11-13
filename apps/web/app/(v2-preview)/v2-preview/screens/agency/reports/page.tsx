import { ClientReportsScreen } from '../../../../../../components/v2/screens/agency/ReportsScreen';
import { clientReportsPreview } from '../../../_preview/agency-reports';
import { previewOnly } from '../../../_preview/guard';

/** Final-Ag-Reports: Northwind Digital’s client reports, read by its owner. */
export default function AgencyReportsPreview() {
  previewOnly();
  return <ClientReportsScreen data={clientReportsPreview('/v2-preview/screens/agency/reports')} />;
}
