import { previewOnly } from '../../_preview/guard';
import { PublicReportPreview } from '../../_preview/PublicReportPreview';

export default function PublicReportScreenPreview() {
  previewOnly();
  return <PublicReportPreview name="bad-site" />;
}
