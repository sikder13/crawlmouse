import { Button } from '../../Button';
import { Card } from '../../Card';
import { Field } from '../../Field';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import { LOG_IN, MARKETING_NAV } from '../../footer-links';
import { count } from '../words';
import type { HomeScreenData } from '../types';
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

/** The locked Home screen (Final-Home), built from the v2 primitives. */
export function HomeScreen({ data }: { data: HomeScreenData }) {
  const { crawlers, withoutJs, alert } = data;
  const botShare = Math.round((withoutJs.botWords / withoutJs.browserWords) * 100);

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
          <form className={styles.heroForm} aria-label="Start an audit">
            <Field
              id="url"
              label="Website URL"
              hideLabel
              type="url"
              placeholder="yourdomain.com"
              autoComplete="url"
              size="lg"
              className={styles.heroInput}
            />
            <Button type="submit" variant="primary" size="lg" className={styles.heroButton}>
              Start the audit
            </Button>
          </form>
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
            Firewalls, bot managers and client-side rendering never show up in that file. Crawlmouse
            requests each page as each crawler and keeps the answer: status, headers, first bytes.
            If a bot got a challenge page, you&apos;ll see the challenge page.
          </p>
          <Card className={styles.tableCard}>
            <Table
              label="What each crawler got back"
              columns={[
                { header: 'Crawler' },
                { header: 'Homepage' },
                { header: `Product pages · ${count(crawlers.productPages)}` },
                { header: 'Text it can read', numeric: true, mono: true },
                { header: "What's in the way", muted: true },
              ]}
              rows={crawlers.rows.map((r) => ({
                key: r.crawler,
                cells: [
                  r.crawler,
                  <StatusPill key="h" state={r.homepage.state}>
                    {r.homepage.label}
                  </StatusPill>,
                  <StatusPill key="p" state={r.productPages.state}>
                    {r.productPages.label}
                  </StatusPill>,
                  `${r.textPercent}%`,
                  r.obstacle,
                ],
              }))}
            />
          </Card>
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
                <div className={`${layout.mut} ${styles.micro}`}>words · {botShare}%</div>
              </div>
            </div>
            <div className={styles.shareTrack}>
              <div className={styles.shareFill} style={{ width: `${botShare}%` }} />
            </div>
            <div className={`${layout.mut} ${styles.micro} ${styles.shareNote}`}>
              {count(withoutJs.templatePages)} product pages share this template.
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
              {alert.domain} · {alert.changedFile} changed at {alert.changedAt} ·{' '}
              {count(alert.pagesAffected)} pages affected
            </div>
            <div className={`${layout.mono} ${styles.diff}`}>
              {alert.diff.context}
              <br />- {alert.diff.removed}
              <br />
              <strong className={styles.diffAdded}>+ {alert.diff.added}</strong>
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
            Every new account gets Pro for 14 days. When that ends, nothing is deleted.
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
            <form
              className={`${styles.heroForm} ${styles.closingForm}`}
              aria-label="Start an audit"
            >
              <Field
                id="url2"
                label="Website URL"
                hideLabel
                type="url"
                placeholder="yourdomain.com"
                autoComplete="url"
                size="lg"
                className={styles.closingInput}
              />
              {/* Decision 2: the screen's one orange element is the hero button; this repeat is neutral. */}
              <Button
                type="submit"
                size="lg"
                className={`${styles.heroButton} ${styles.closingButton}`}
              >
                Start the audit
              </Button>
            </form>
          </Card>
        </section>
      </main>
    </PageShell>
  );
}
