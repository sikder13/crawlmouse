import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Table } from '../../Table';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { CheckPageView } from '../../../../lib/v2/view/check-pages';
import { AuditForm } from '../home/AuditForm';
import layout from '../../layout.module.css';
import home from '../home/HomeScreen.module.css';

/**
 * A `/check` page (CC-29 D8). No artboard exists, so it is the Home screen's own parts in the
 * home's styles: its hero with the question as the h1 and the home's audit form (the one orange
 * element), one section of explanation in the home's section type, and the home's closing card with
 * the form again, neutral. Nothing here is a new pattern.
 */
export function CheckPageScreen({ data, start = false }: { data: CheckPageView; start?: boolean }) {
  return (
    <PageShell
      nav={MARKETING_NAV}
      actions={
        <Button variant="quiet" href={LOG_IN.href}>
          {LOG_IN.label}
        </Button>
      }
    >
      <main>
        <section className={`${layout.wrap} ${home.hero}`}>
          <Heading level={1} size="xl" className={home.heroTitle}>
            {data.h1}
          </Heading>
          <p className={home.heroSub}>{data.sub}</p>
          <AuditForm
            fieldId="url"
            label={data.formLabel}
            primary
            start={start}
            className={home.heroForm}
            inputClassName={home.heroInput}
            buttonClassName={home.heroButton}
          />
          <p className={`${layout.mut} ${home.heroNote}`}>{data.heroNote}</p>
        </section>

        <section className={layout.wrap}>
          <Heading level={2} size="l" className={home.narrow}>
            {data.heading}
          </Heading>
          {data.blocks.map((block) =>
            block.kind === 'paragraph' ? (
              <p key={block.text} className={home.sub}>
                {block.text}
              </p>
            ) : (
              <Card key={block.label} className={home.tableCard}>
                <Table
                  label={block.label}
                  columns={block.columns.map((header) => ({ header }))}
                  rows={block.rows}
                  rowHeader
                />
              </Card>
            ),
          )}
        </section>

        <section className={`${layout.wrap} ${home.sec}`}>
          <Card tone="sunken" className={home.closing}>
            <Heading level={2} size="m" className={home.closingTitle}>
              {data.closing}
            </Heading>
            <AuditForm
              fieldId="url2"
              primary={false}
              start={start}
              className={`${home.heroForm} ${home.closingForm}`}
              inputClassName={home.closingInput}
              buttonClassName={`${home.heroButton} ${home.closingButton}`}
            />
          </Card>
        </section>
      </main>
    </PageShell>
  );
}
