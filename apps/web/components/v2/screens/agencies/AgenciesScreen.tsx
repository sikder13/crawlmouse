import { Button } from '../../Button';
import { Card } from '../../Card';
import { Grade } from '../../Grade';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Table } from '../../Table';
import { VisuallyHidden } from '../../VisuallyHidden';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { AgenciesView } from '../../../../lib/v2/view/agencies';
import { AuditForm } from '../home/AuditForm';
import { Capability } from './Capability';
import layout from '../../layout.module.css';
import styles from './AgenciesScreen.module.css';

/** How the prospect's audit is started: the home's form, live or (the preview) posting nowhere, or a link home. */
export type ProspectAudit = 'live' | 'preview' | 'home-link';

/**
 * For agencies (Final-Agencies, CC-29 D4). The one orange element is the trial button (DESIGN-LOCK
 * §6: "For agencies → the trial button"); the prospect's audit form is the home's, neutral. Every
 * piece of copy that names a capability carries it (`Capability`), and the one-pager preview as a
 * whole carries its own.
 */
export function AgenciesScreen({
  data,
  audit = 'preview',
}: {
  data: AgenciesView;
  audit?: ProspectAudit;
}) {
  const c = data.comingLabel;
  const op = data.onePager;
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
        <section className={`${layout.wrap} ${styles.hero}`}>
          <Heading level={1} size="xl" className={styles.title}>
            {data.h1}
          </Heading>
          {data.hero.map((item) => (
            <Capability key={item.text} as="p" item={item} comingLabel={c} className={styles.sub} />
          ))}
          <div className={`${layout.row} ${styles.trialRow}`}>
            <span data-capability={data.trial.capabilities.join(' ')}>
              <Button variant="primary" size="lg" href={data.trial.href}>
                {data.trial.text}
              </Button>
            </span>
            <Capability item={data.trialNote} comingLabel={c} className={layout.mut} />
          </div>
        </section>

        <section className={`${layout.wrap} ${styles.sec}`}>
          <Card className={styles.prospect}>
            <div>
              <Capability
                as="div"
                item={data.prospect.title}
                comingLabel={c}
                className={styles.prospectTitle}
              />
              {data.prospect.lines.map((item) => (
                <Capability
                  key={item.text}
                  as="div"
                  item={item}
                  comingLabel={c}
                  className={`${layout.mut} ${styles.small}`}
                />
              ))}
            </div>
            {audit === 'home-link' ? (
              <Button href="/">{data.prospect.homeLink}</Button>
            ) : (
              <AuditForm
                fieldId="url"
                label={data.prospect.formLabel}
                primary={false}
                start={audit === 'live'}
                className={styles.form}
                inputClassName={styles.formInput}
              />
            )}
          </Card>
        </section>

        <section
          className={`${layout.wrap} ${styles.sec}`}
          data-capability={op.capabilities.join(' ')}
        >
          <Card className={styles.flush}>
            <div className={`${layout.row} ${styles.cardHead}`}>
              <div>
                <Heading level={2} size="s">
                  <Capability item={op.title} comingLabel={c} />
                </Heading>
                <Capability
                  as="div"
                  item={op.sub}
                  comingLabel={c}
                  className={`${layout.mut} ${styles.small}`}
                />
              </div>
              <span className={`${layout.mut} ${styles.micro}`}>{op.label}</span>
            </div>
            <div className={styles.paper}>
              <Card className={styles.onePager}>
                <div className={`${layout.row} ${styles.between}`}>
                  <span className={`${layout.row} ${styles.agency}`}>
                    <span className={styles.logo} aria-hidden="true" />
                    {op.agency}
                  </span>
                  <span className={`${layout.mut} ${styles.micro}`}>{op.meta}</span>
                </div>
                <Heading level={3} size="m" className={styles.opHeading}>
                  {op.heading}
                </Heading>
                <div className={`${layout.row} ${styles.grades}`}>
                  {op.grades.map((g) =>
                    g.withheld ? (
                      <Grade key={g.label} label={g.label} withheld />
                    ) : (
                      <Grade
                        key={g.label}
                        label={g.label}
                        letter={g.letter ?? undefined}
                        score={g.score ?? undefined}
                        tone={g.tone}
                      />
                    ),
                  )}
                </div>
                <Table
                  label={op.fixesCaption}
                  className={styles.fixes}
                  headersHidden
                  columns={[
                    { header: 'Number', mono: true, muted: true },
                    { header: 'Fix' },
                    { header: 'Estimated effect', numeric: true, mono: true },
                  ]}
                  rows={op.fixes.map((f) => ({ key: f.key, cells: [f.n, f.title, f.points] }))}
                />
                <div className={`${layout.mut} ${styles.micro} ${styles.opFoot}`}>
                  <div>{op.estimates}</div>
                  <div>{op.footer}</div>
                </div>
              </Card>
            </div>
          </Card>
        </section>

        <section className={`${layout.wrap} ${styles.sec} ${styles.g2}`}>
          <Card className={styles.flush}>
            <div className={styles.cardHead}>
              <Heading level={2} size="s">
                {data.compare.title}
              </Heading>
            </div>
            <Table
              label={data.compare.title}
              columns={[
                { header: <VisuallyHidden>{data.compare.columns[0]}</VisuallyHidden> },
                { header: data.compare.columns[1], numeric: true },
                { header: data.compare.columns[2], numeric: true },
              ]}
              rows={data.compare.rows.map((r) => {
                const tag = r.label.capabilities.join(' ');
                return {
                  key: r.key,
                  cells: [
                    <Capability key="l" item={r.label} comingLabel={c} />,
                    <span key="p" data-capability={tag} className={layout.mono}>
                      {r.pro}
                    </span>,
                    <span key="a" data-capability={tag}>
                      {r.agency}
                    </span>,
                  ],
                };
              })}
            />
          </Card>
          <div className={styles.stack}>
            <Card className={styles.padded}>
              <Heading level={2} size="s">
                {data.uses.title}
              </Heading>
              <ol className={styles.steps}>
                {data.uses.steps.map((item) => (
                  <Capability key={item.text} as="li" item={item} comingLabel={c} />
                ))}
              </ol>
            </Card>
            <Card className={styles.padded}>
              <Heading level={2} size="s">
                {data.cost.title}
              </Heading>
              {data.cost.lines.map((item) => (
                <Capability
                  key={item.text}
                  as="p"
                  item={item}
                  comingLabel={c}
                  className={styles.costLine}
                />
              ))}
              <Button variant="quiet" size="sm" href={data.cost.compare.href}>
                {data.cost.compare.label}
              </Button>
            </Card>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
