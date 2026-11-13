import Link from 'next/link';
import type { ResultRow } from '../../../../lib/v2/ops/console-view';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { Field } from '../../Field';
import { Heading } from '../../Heading';
import { PageShell } from '../../PageShell';
import { StatusPill } from '../../StatusPill';
import { Table } from '../../Table';
import layout from '../../layout.module.css';
import styles from './Console.module.css';

export interface ConsoleSearchProps {
  /** The accounts a search found, or null when the page was opened without one. */
  results: ResultRow[] | null;
  /** The last search found nothing. */
  nothingFound: boolean;
}

/**
 * The support console's search (CC-33 D2): one field, posted to /api/internal/search so the query is
 * in no URL, and the accounts a search with several results found. Staff tooling: no artboard.
 */
export function ConsoleSearchScreen({ results, nothingFound }: ConsoleSearchProps) {
  return (
    <PageShell header="app" footer={false}>
      {/* PostHog is not started on a page loaded under /internal (instrumentation-client.ts). As a
          second guard, should it be running: `ph-no-capture` keeps its autocapture off this staff
          page, and `data-ph-mask` masks its text in an error replay. */}
      <main className={`${layout.wrap} ${styles.main} ph-no-capture`} data-ph-mask="">
        <div className={styles.header}>
          <Heading level={1} size="l">
            Support console
          </Heading>
        </div>
        <Card as="section" className={styles.panel} aria-label="Search">
          <form method="post" action="/api/internal/search" className={styles.search}>
            <div className={styles.searchField}>
              <Field
                id="console-q"
                name="q"
                type="search"
                label="Email, account id, site host, check id or Stripe customer id"
                autoComplete="off"
                required
              />
            </div>
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
        </Card>
        {nothingFound ? <p className={styles.notice}>No account matches that search.</p> : null}
        {results !== null ? (
          <Card as="section" className={styles.panel} aria-label="Accounts found">
            <Heading level={2} size="s">
              Accounts found
            </Heading>
            <Table
              label="Accounts found"
              rowHeader
              columns={[
                { header: 'Account' },
                { header: 'Kind' },
                { header: 'State' },
                { header: 'Tier' },
                { header: 'Id', mono: true, hideOnPhone: true },
              ]}
              rows={results.map((r) => ({
                key: r.id,
                muted: r.deleted,
                cells: [
                  <span key="n" className={styles.action}>
                    <Link href={r.href} prefetch={false}>
                      {r.name}
                    </Link>
                    {r.internal ? <StatusPill state="warn">Internal</StatusPill> : null}
                    {r.deleted ? <StatusPill state="neutral">Deleted</StatusPill> : null}
                  </span>,
                  r.kind,
                  r.state,
                  r.tier,
                  r.id,
                ],
              }))}
            />
          </Card>
        ) : null}
      </main>
    </PageShell>
  );
}
