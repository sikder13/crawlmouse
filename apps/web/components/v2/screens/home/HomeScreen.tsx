import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Table } from '../../Table';
import { VerdictCell } from '../../VerdictCell';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import type { HomeView } from '../../../../lib/v2/view/home';
import { count } from '../../../../lib/v2/words';
import { AuditForm } from './AuditForm';
import { Stage } from './Stage';
import layout from '../../layout.module.css';
import styles from './HomeScreen.module.css';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    per: null,
    body: 'One site, checked monthly. The full crawler matrix, three complete fixes per audit, history kept.',
    action: 'Create a free account',
    note: 'Includes 14 days of Pro',
  },
  {
    name: 'Pro',
    price: '$19',
    per: ' a month',
    body: 'Five sites, checked weekly. Every fix with a copy-paste packet, alerts to Slack, one competitor per site, PDF and CSV export.',
    action: 'Start with 14 days of Pro',
    note: 'The same free account; $19 a month only if you keep Pro',
  },
  {
    name: 'Agency',
    price: '$69',
    per: ' a month',
    body: 'Twenty-five client sites, five seats, reports on your domain with your logo, and a one-page audit you can hand to a prospect.',
    action: 'Start a 14-day trial',
    note: 'Card required; nothing charged for 14 days',
  },
];

/**
 * The locked Home screen (Final-Home). The example audit, the crawler table, the words card and the
 * alert come from the bad-site fixture through `homeView`; the marketing copy is the lock's.
 */
export function HomeScreen({ data }: { data: HomeView }) {
  const { crawlers, withoutJs, alert } = data;

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
          <Heading level={1} size="xl" className={styles.heroTitle}>
            Can ChatGPT, Claude and Google actually read your site?
          </Heading>
          <p className={styles.heroSub}>
            Crawlmouse crawls your site as each of them, shows you what they got back, and keeps
            checking so you hear about the next broken plugin before anyone else does.
          </p>
          <AuditForm
            fieldId="url"
            label="Start an audit"
            primary
            className={styles.heroForm}
            inputClassName={styles.heroInput}
            buttonClassName={styles.heroButton}
          />
          <p className={`${layout.mut} ${styles.heroNote}`}>
            Free · up to 500 pages · about two minutes · nothing to install · the result is kept 24
            hours; one email keeps it longer
          </p>
        </section>

        <section className={layout.wrap}>
          <Stage example={data.example} />
          <div className={`${layout.row} ${styles.stageNotes}`}>
            <span className={layout.mut}>
              An example audit, replayed. Yours builds the same way while you watch.
            </span>
            <span className={layout.mut}>
              No language model in the engine: the same site gets the same grade every time.
            </span>
          </div>
        </section>

        <section className={`${layout.wrap} ${styles.sec}`}>
          <Heading level={2} size="l" className={styles.narrow}>
            robots.txt says what you intend. It doesn&apos;t say what happened.
          </Heading>
          <p className={styles.sub}>
            {/* FACTS I1, I6: AI crawlers are tested on a sample from every template, not every page. */}
            Firewalls, bot managers and client-side rendering never show up in that file. Crawlmouse
            requests a sample of pages from every template as each AI crawler and keeps the answer:
            status, headers, first bytes. If a bot got a challenge page, you&apos;ll see the
            challenge page.
          </p>
          <Card className={styles.tableCard}>
            <Table
              label="What each crawler got back"
              columns={[
                { header: 'Crawler' },
                { header: 'Homepage' },
                { header: crawlers.productHeader },
                { header: 'Text it can read', numeric: true, mono: true },
                { header: "What's in the way", muted: true },
              ]}
              rows={crawlers.rows.map((r) => ({
                key: r.crawler,
                cells: [
                  r.crawler,
                  <VerdictCell
                    key="h"
                    verdict={r.homepage.verdict}
                    evidence={r.homepage.evidence}
                  />,
                  <VerdictCell
                    key="p"
                    verdict={r.products.verdict}
                    evidence={r.products.evidence}
                  />,
                  r.text,
                  r.obstacle,
                ],
              }))}
            />
          </Card>
          {/* FACTS D1: one line under every crawler table. */}
          <p className={`${layout.mut} ${styles.tableNote}`}>
            Tested with tagged user agents from published IPs —{' '}
            <a href="/bot">crawlmouse.com/bot</a>.
          </p>
        </section>

        <section className={`${layout.wrap} ${styles.sec} ${styles.g2}`}>
          <div>
            <Heading level={2} size="l">
              GPTBot and ClaudeBot don&apos;t run JavaScript. How much of your page is left?
            </Heading>
            <p className={styles.sub}>
              We compare what a browser renders with the raw response the bot receives, page by
              page, and give you the number.
            </p>
          </div>
          <Card className={styles.wordsCard}>
            <div className={`${layout.mono} ${layout.mut}`}>{withoutJs.path}</div>
            <div className={`${layout.row} ${styles.words}`}>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>A browser sees</div>
                <div className={styles.bigNumber}>{count(withoutJs.browserWords)}</div>
                <div className={`${layout.mut} ${styles.micro}`}>words</div>
              </div>
              <div>
                <div className={`${layout.mut} ${styles.small}`}>{withoutJs.bot} sees</div>
                <div className={`${styles.bigNumber} ${styles.bad}`}>
                  {count(withoutJs.botWords)}
                </div>
                <div className={`${layout.mut} ${styles.micro}`}>words · {withoutJs.share}%</div>
              </div>
            </div>
            <div className={styles.shareTrack}>
              <div className={styles.shareFill} style={{ width: `${withoutJs.share}%` }} />
            </div>
            <div className={`${layout.mut} ${styles.micro} ${styles.shareNote}`}>
              {count(withoutJs.templatePages)} {withoutJs.templateNoun} pages share this template.
            </div>
          </Card>
        </section>

        <section className={`${layout.wrap} ${styles.sec} ${styles.g2}`}>
          <Card className={styles.alertCard}>
            <div className={`${layout.row} ${styles.alertHead}`}>
              <strong className={styles.alertTitle}>{alert.title}</strong>
              <span className={`${layout.mono} ${layout.mut}`}>{alert.time}</span>
            </div>
            <div className={`${layout.mut} ${styles.alertMeta}`}>
              {alert.domain} · {alert.changedFile} changed
              {alert.changedAt ? ` ${alert.changedAt}` : ''} · {count(alert.pagesAffected)} pages
              affected
            </div>
            <div className={`${layout.mono} ${styles.diff}`}>
              {alert.diff.removed.map((line) => (
                <div key={`-${line}`}>- {line}</div>
              ))}
              {alert.diff.added.map((line) => (
                <div key={`+${line}`}>
                  <strong className={styles.diffAdded}>+ {line}</strong>
                </div>
              ))}
            </div>
            <div className={`${layout.row} ${styles.alertActions}`} aria-hidden="true">
              <Button presentational size="sm">
                Open the diff
              </Button>
              <Button presentational size="sm">
                Copy the fix
              </Button>
            </div>
          </Card>
          <div>
            <Heading level={2} size="l">
              Things break quietly, on a Tuesday, after a plugin update.
            </Heading>
            <p className={styles.sub}>
              Crawlmouse re-checks on a schedule and writes to you only when something changed. One
              line, one diff, one fix.
            </p>
          </div>
        </section>

        <section className={`${layout.wrap} ${styles.sec}`}>
          <Heading level={2} size="l" className={styles.narrow}>
            Free to look. Paid when you want it watched.
          </Heading>
          <p className={styles.sub}>
            Every new account gets Pro for 14 days. When that ends, nothing you can see is deleted.
          </p>
          <div className={styles.g3}>
            {PLANS.map((p) => (
              <Card key={p.name} className={styles.plan}>
                <div className={layout.mut}>{p.name}</div>
                <div className={styles.price}>
                  {p.price}
                  {p.per ? <span className={`${layout.mut} ${styles.per}`}>{p.per}</span> : null}
                </div>
                <p className={styles.planBody}>{p.body}</p>
                <Button href="#" className={styles.planButton}>
                  {p.action}
                </Button>
                <div className={`${layout.mut} ${styles.planNote}`}>{p.note}</div>
              </Card>
            ))}
          </div>
        </section>

        <section className={`${layout.wrap} ${styles.sec}`}>
          <Card tone="sunken" className={styles.closing}>
            <Heading level={2} size="m" className={styles.closingTitle}>
              Two minutes from now you&apos;ll know what each crawler sees.
            </Heading>
            {/* Decision 2: the screen's one orange element is the hero button; this repeat is neutral. */}
            <AuditForm
              fieldId="url2"
              primary={false}
              className={`${styles.heroForm} ${styles.closingForm}`}
              inputClassName={styles.closingInput}
              buttonClassName={`${styles.heroButton} ${styles.closingButton}`}
            />
          </Card>
        </section>
      </main>
    </PageShell>
  );
}
