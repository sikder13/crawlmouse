import { Select } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { previewOnly } from '../_preview/guard';

const SITES = [
  { value: 'example-outfitter.com', label: 'example-outfitter.com' },
  { value: 'nahltech.com', label: 'nahltech.com' },
];

export default function SelectPreview() {
  previewOnly();
  return (
    <PreviewFrame title="Select">
      <PreviewSection title="Hidden label, as on Final-Reports">
        <PreviewRow>
          <Select id="pv-site" label="Site" hideLabel name="site" options={SITES} />
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Visible label">
        <Select
          id="pv-site-2"
          label="Site"
          name="site"
          options={SITES}
          defaultValue="nahltech.com"
        />
      </PreviewSection>
    </PreviewFrame>
  );
}
