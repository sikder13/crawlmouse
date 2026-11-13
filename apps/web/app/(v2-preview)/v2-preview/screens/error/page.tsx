import { ErrorPreview } from '../../_preview/ErrorPreview';
import { previewOnly } from '../../_preview/guard';

export default function ErrorScreenPreview() {
  previewOnly();
  return <ErrorPreview />;
}
