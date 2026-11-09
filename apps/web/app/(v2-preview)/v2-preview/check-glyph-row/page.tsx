import { CheckGlyph, CheckGlyphRow } from '../../../../components/v2';
import { spokenRun, verdictCell } from '../../../../components/v2/screens/account/verdict-cells';
import { PreviewFrame, PreviewRow, PreviewSection } from '../_preview/PreviewFrame';
import { dashboardPreview } from '../_preview/accounts';
import { previewOnly } from '../_preview/guard';

/** bad-site's AI crawlers across example-outfitter.com's six checks. */
export default function CheckGlyphRowPreview() {
  previewOnly();
  const rows = dashboardPreview('home').crawlersByCheck!;
  return (
    <PreviewFrame title="CheckGlyphRow">
      <PreviewSection title="A row per crawler, a glyph per check">
        {rows.map((r) => {
          const cells = r.verdicts.map((v) => verdictCell(v, r.group));
          return (
            <PreviewRow key={r.ua}>
              <span style={{ width: 140 }}>{r.ua}</span>
              <CheckGlyphRow cells={cells} spoken={spokenRun(cells)} />
            </PreviewRow>
          );
        })}
      </PreviewSection>
      <PreviewSection title="One check, as a grid cell">
        <PreviewRow>
          {rows[rows.length - 1]!.verdicts.map((v, i) => (
            <CheckGlyph key={i} cell={verdictCell(v, 'ai_training')} />
          ))}
        </PreviewRow>
      </PreviewSection>
    </PreviewFrame>
  );
}
