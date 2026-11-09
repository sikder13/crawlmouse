import { Card, GradeHistory } from '../../../../components/v2';
import { PreviewFrame, PreviewSection } from '../_preview/PreviewFrame';
import { dashboardPreview } from '../_preview/accounts';
import { previewOnly } from '../_preview/guard';

/** example-outfitter.com's six checks, from bad-site's dashboard on day 9. */
export default function GradeHistoryPreview() {
  previewOnly();
  const h = dashboardPreview('home').history!;
  return (
    <PreviewFrame title="GradeHistory">
      <PreviewSection title="Six checks, two grades, a note and a marked point">
        <Card>
          <GradeHistory
            label={h.title}
            labels={h.points.map((p) => p.label)}
            dates={h.points.map((p) => p.date)}
            series={[
              { name: 'Technical SEO', values: h.points.map((p) => p.seo) },
              { name: 'AI readability', values: h.points.map((p) => p.ai), dashed: true },
            ]}
            caption={h.summary}
            note={h.flatNote ? { series: 1, text: h.flatNote } : null}
            marker={
              h.marker
                ? {
                    series: 1,
                    index: h.marker.index,
                    text: h.marker.label,
                    verdicts: h.marker.verdicts,
                  }
                : null
            }
          />
        </Card>
      </PreviewSection>
    </PreviewFrame>
  );
}
