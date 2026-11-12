import { MatrixScreen } from '../../../../../components/v2/screens/agency/MatrixScreen';
import { agencyPreview } from '../../_preview/agency';
import { previewOnly } from '../../_preview/guard';

/** Final-Ag-Matrix: Northwind Digital, read by its owner. */
export default function AgencyMatrixPreview() {
  previewOnly();
  return <MatrixScreen data={agencyPreview('/v2-preview/screens/agency')} />;
}
