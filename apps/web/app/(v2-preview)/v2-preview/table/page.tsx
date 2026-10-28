import { Card, StatusPill, Table } from '../../../../components/v2';
import { PreviewFrame, PreviewSection } from '../_preview/PreviewFrame';

export default function TablePreview() {
  return (
    <PreviewFrame title="Table">
      <PreviewSection title="Records, with a numeric column">
        <Card>
          <Table
            label="What each crawler got back"
            columns={[
              { header: 'Crawler' },
              { header: 'Homepage' },
              { header: 'Text it can read', numeric: true, mono: true },
              { header: "What's in the way" },
            ]}
            rows={[
              {
                key: 'googlebot',
                cells: [
                  'Googlebot',
                  <StatusPill key="s" state="ok">
                    200
                  </StatusPill>,
                  '100%',
                  'nothing, it renders JavaScript',
                ],
              },
              {
                key: 'gptbot',
                cells: [
                  'GPTBot',
                  <StatusPill key="s" state="bad">
                    403
                  </StatusPill>,
                  '0%',
                  'a Cloudflare firewall rule',
                ],
              },
              {
                key: 'pro',
                muted: true,
                cells: ['Nine more, grouped by type', '', '+5 SEO', 'See with Pro'],
              },
            ]}
          />
        </Card>
      </PreviewSection>
    </PreviewFrame>
  );
}
