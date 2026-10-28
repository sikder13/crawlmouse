import { CoverageLine } from '../../../../components/v2';
import { PreviewFrame, PreviewSection } from '../_preview/PreviewFrame';
import { previewOnly } from '../_preview/guard';

export default function CoverageLinePreview() {
  previewOnly();
  return (
    <PreviewFrame title="CoverageLine">
      <PreviewSection title="A sample across templates">
        <CoverageLine tested={50} total={214} groups={4} />
      </PreviewSection>
      <PreviewSection title="Singular and thousands">
        <CoverageLine tested={1} total={1} groups={1} />
        <CoverageLine tested={1284} total={2000} groups={12} />
      </PreviewSection>
    </PreviewFrame>
  );
}
