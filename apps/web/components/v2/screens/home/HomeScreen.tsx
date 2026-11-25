import { AccountLink } from '../../AccountLink';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { Table } from '../../Table';
import { VerdictCell } from '../../VerdictCell';
import { FOR_AGENCIES, MARKETING_NAV } from '../../footer-links';
import { GATES } from '../../../../lib/entitlement-v2';
import type { Tagged } from '../../../../lib/v2/copy/agencies';
import { PRICING_COPY, planPages } from '../../../../lib/v2/copy/pricing';
import type { Features } from '../../../../lib/v2/features';
import { shown, taggedWith } from '../../../../lib/v2/view/agencies';
import type { HomeView } from '../../../../lib/v2/view/home';
import { formatPlanPrice } from '../../../../lib/v2/copy/plan-price';
import { count, numberWord, plural } from '../../../../lib/v2/words';
import { AuditForm } from './AuditForm';
import { Stage } from './Stage';
import layout from '../../layout.module.css';
import styles from './HomeScreen.module.css';

/** "a and b", "a, b, and c": the serial comma the locked card uses. */
const andList = (items: readonly string[]) =>
  items.length === 2
    ? `${items[0]} and ${items[1]}`
    : items
        .map((x, i) => (i === 0 ? x : i === items.length - 1 ? `, and ${x}` : `, ${x}`))
        .join('');

/**
 * The phrases of a card the Goal 1 switch shows. Each phrase names its capabilities, and
 * `CAPABILITIES[key].risk` (lib/v2/view/agencies.ts) names the switch that hides it, as on Pricing.
 */
const said = (f: Features, phrases: Tagged[]) =>
  shown(phrases.map(taggedWith(f))).map((t) => t.text);

/** "up to 2,000 pages a site", or nothing while `pages_2000` is hidden (Pricing's `planPages`). */
const pageLimit = (tier: 'pro' | 'agency', f: Features): Tagged[] => {
  const pages = planPages(tier, f.pages_2000);
  return pages === null ? [] : [{ text: `up to ${pages} a site`, capabilities: [] }];
};

interface PlanCard {
  name: string;
  price: string;
  per: string | null;
  body: string;
  /** Null: the card has no button. */
  action: string | null;
  note: string;
  /** A link after the note, its label saying where it leads. */
  noteLink?: { label: string; href: string };
}

/** The closed Agency card's link: where the plan is described, named for what is there. */
const AGENCY_DETAILS = { label: 'See what Agency includes', href: FOR_AGENCIES.href };

/**
 * The plan cards, without what the Goal 1 switch hides; with nothing hidden, the locked words and
 * the paid plans' page limit. `agencyOpen` false (Agency not on sale): its card offers no trial and
 * says the plan opens, then links to For agencies. `billingOpen` false (V2_BILLING not public): Pro
 * cannot be bought, so its note is Pricing's billing-off note and names no price.
 */
function plans(f: Features, agencyOpen: boolean, billingOpen: boolean): PlanCard[] {
  const competitors = GATES.pro.competitorsPerSite;
  const pro = said(f, [
    { text: 'Every fix with a copy-paste packet', capabilities: ['fix_packets'] },
    { text: 'alerts to Slack', capabilities: ['slack_alerts'] },
    {
      text: `${numberWord(competitors)} ${plural(competitors, 'competitor', 'competitors')} per site`,
      capabilities: ['competitors'],
    },
    { text: 'PDF and CSV export', capabilities: ['exports'] },
  ]);
  const proLimit = pageLimit('pro', f)
    .map((p) => `, ${p.text}`)
    .join('');
  const agency = said(f, [
    { text: 'Twenty-five client sites', capabilities: ['sites'] },
    ...pageLimit('agency', f),
    { text: 'five seats', capabilities: ['seats'] },
    // The client report page (row 24) on the agency's domain (row 25): either hidden drops it.
    { text: 'reports on your domain with your logo', capabilities: ['client_report_page'] },
    { text: 'a one-page audit you can hand to a prospect', capabilities: ['one_pagers'] },
  ]);
  return [
    {
      name: 'Free',
      price: formatPlanPrice('free'),
      per: null,
      body: 'One site, checked monthly. The full crawler matrix, three complete fixes per audit, history kept.',
      action: 'Create a free account',
      note: 'Includes 14 days of Pro',
    },
    {
      name: 'Pro',
      price: formatPlanPrice('pro'),
      per: ' a month',
      body: `Five sites${proLimit}, checked weekly. ${pro.join(', ')}.`,
      action: 'Start with 14 days of Pro',
      note: billingOpen
        ? `The same free account; ${formatPlanPrice('pro')} a month only if you keep Pro`
        : PRICING_COPY.buttons.proTrialBillingOff.note,
    },
    {
      name: 'Agency',
      price: formatPlanPrice('agency'),
      per: ' a month',
      body: `${andList(agency)}.`,
      ...(agencyOpen
        ? { action: 'Start a 14-day trial', note: 'Card required; nothing charged for 14 days' }
        : {
            action: null,
            note: `${PRICING_COPY.buttons.agencyStartFree.note}.`,
            noteLink: AGENCY_DETAILS,
          }),
    },
  ];
}

/**
 * The locked Home screen (Final-Home). The example audit, the crawler table, the words card and the
 * alert come from the bad-site fixture through `homeView`; the marketing copy is the lock's.
 */
export function HomeScreen({
  data,
  start = false,
  planHref,
  agencyOpen = true,
  billingOpen = true,
}: {
  data: HomeView;
  /** The forms start an audit (`POST /api/checks`); omitted (the preview), they post nowhere. */
  start?: boolean;
  /**
   * Where a plan's button goes on a page that has a route for it. Given, a plan it names no route
   * for has no button; omitted (the preview), each button renders as the locked screen shows it.
   */
  planHref?: Partial<Record<string, string>>;
  /**
   * Whether Agency is on sale (`billingPublic() && agencySalesOpen()`, read by the entry point).
   * Omitted (the preview), it is, as the locked screen shows it.
   */
  agencyOpen?: boolean;
  /**
   * Whether a paid plan can be bought (`billingPublic()`, read by the entry point). Omitted (the
   * preview), it can, as the locked screen shows it.
   */
  billingOpen?: boolean;
}) {
  const { crawlers, withoutJs, alert } = data;
  // `nojs` hidden: the crawler table loses its "Text it can read" column, header and cells together.
  const nojs = data.features.nojs;

  return (
    <PageShell nav={MARKETING_NAV} actions={<AccountLink />}>
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
            start={start}
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
          <Stage example={data.example} nojs={nojs} />
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
            {/* `nojs` hidden: the table names no client-rendered row, so this does not promise one. */}
            {`${nojs ? 'Firewalls, bot managers and client-side rendering' : 'Firewalls and bot managers'} never show up in that file. Crawlmouse requests a sample of pages from every template as each AI crawler and keeps the answer: status, headers, first bytes. If a bot got a challenge page, you'll see the challenge page.`}
          </p>
          <Card className={styles.tableCard}>
            <Table
              label="What each crawler got back"
              columns={[
                { header: 'Crawler' },
                { header: 'Homepage' },
                { header: crawlers.productHeader },
                ...(nojs ? [{ header: 'Text it can read', numeric: true, mono: true }] : []),
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
                  ...(nojs ? [r.text] : []),
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

        {/* `nojs` hidden drops this whole section, its h2 ("GPTBot and ClaudeBot don't run
            JavaScript…") with it: the heading introduces the words card's figure. */}
        {nojs ? (
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
        ) : null}

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
              Things break quietly, after a plugin update.
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
            {plans(data.features, agencyOpen, billingOpen).map((p) => (
              <Card key={p.name} className={styles.plan}>
                <div className={layout.mut}>{p.name}</div>
                <div className={styles.price}>
                  {p.price}
                  {p.per ? <span className={`${layout.mut} ${styles.per}`}>{p.per}</span> : null}
                </div>
                <p className={styles.planBody}>{p.body}</p>
                {p.action === null || (planHref && planHref[p.name] === undefined) ? null : (
                  <Button href={planHref?.[p.name] ?? '#'} className={styles.planButton}>
                    {p.action}
                  </Button>
                )}
                <div className={`${layout.mut} ${styles.planNote}`}>
                  {p.note}
                  {p.noteLink ? (
                    <>
                      {' '}
                      <a href={p.noteLink.href}>{p.noteLink.label}</a>
                    </>
                  ) : null}
                </div>
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
              start={start}
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
