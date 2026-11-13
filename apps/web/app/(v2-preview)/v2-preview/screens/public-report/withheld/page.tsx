import { previewOnly } from '../../../_preview/guard';
import { PublicReportPreview } from '../../../_preview/PublicReportPreview';

export default function PublicReportWithheldPreview() {
  previewOnly();
  return <PublicReportPreview name="challenged-site" />;
}
