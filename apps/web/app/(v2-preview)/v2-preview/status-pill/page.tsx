import { StatusPill } from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';

export default function StatusPillPreview() {
  return (
    <PreviewFrame title="StatusPill">
      <PreviewSection title="The four status glyphs">
        <PreviewRow>
          <StatusPill state="ok">200</StatusPill>
          <StatusPill state="warn">empty shell</StatusPill>
          <StatusPill state="bad">403</StatusPill>
          <StatusPill state="unverified">challenged: the real crawler may pass</StatusPill>
        </PreviewRow>
      </PreviewSection>
      <PreviewSection title="Neutral: a count or score, no glyph">
        <PreviewRow>
          <StatusPill state="neutral">74 / 100</StatusPill>
          <StatusPill state="neutral">11 on Pro</StatusPill>
          <StatusPill state="neutral">first audit</StatusPill>
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
