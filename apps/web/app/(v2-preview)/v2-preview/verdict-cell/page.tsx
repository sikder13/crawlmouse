import {
  EVIDENCE_CLASSES,
  Table,
  VERDICTS,
  VerdictCell,
  type EvidenceClass,
  type Verdict,
} from '../../../../components/v2';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import styles from '../_preview/PreviewFrame.module.css';
import { previewOnly } from '../_preview/guard';

const evidence = Object.keys(EVIDENCE_CLASSES) as EvidenceClass[];

export default function VerdictCellPreview() {
  previewOnly();
  const verdicts = Object.keys(VERDICTS) as Verdict[];
  return (
    <PreviewFrame title="VerdictCell">
      <PreviewSection title="Every verdict">
        <p className={styles.note}>
          A glyph marked proposed is not yet set by the facts file; it changes in
          components/v2/verdicts.ts on a design ruling.
        </p>
        <Table
          label="Every verdict and its pill"
          columns={[{ header: 'Verdict', mono: true }, { header: 'Cell' }, { header: 'Mapping' }]}
          rows={verdicts.map((v, i) => ({
            key: v,
            cells: [
              v,
              <VerdictCell
                key={v}
                verdict={v}
                evidence={evidence[i % evidence.length] ?? 'declared'}
              />,
              VERDICTS[v].glyphFromFacts ? 'glyph from FACTS' : 'glyph proposed',
            ],
          }))}
        />
      </PreviewSection>
      <PreviewSection title="Evidence classes">
        <PreviewRow>
          {evidence.map((e) => (
            <VerdictCell key={e} verdict="allowed" evidence={e} />
          ))}
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
