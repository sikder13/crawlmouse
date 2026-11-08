import { Card } from '../../Card';
import type { ChangesLogView, FilterLinkView } from '../../../../lib/v2/view/changes-log';
import { AccountFrame } from '../account/AccountFrame';
import { ChangeTable } from '../segment/ChangesScreen';
import shared from '../account/AccountScreen.module.css';
import styles from './ChangesLogScreen.module.css';

/** One filter: its name, then its choices as links, the one in force marked. */
function FilterGroup({ name, links }: { name: string; links: FilterLinkView[] }) {
  return (
    <ul className={styles.group} aria-label={name}>
      <li className={styles.groupName} aria-hidden="true">
        {name}
      </li>
      {links.map((l) => (
        <li key={l.href}>
          <a href={l.href} className={styles.link} aria-current={l.current ? 'true' : undefined}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every change across the account (D3): CC-23's change rows, site first, newest first, under three
 * filters that change the page's query. Nothing on it is the reader's action, so it has no orange
 * element.
 */
export function ChangesLogScreen({ data }: { data: ChangesLogView }) {
  return (
    <AccountFrame shell={data.shell}>
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{data.title}</h1>
          {data.headline ? (
            <div className={shared.line}>
              {data.headline}
              {data.newNote ? ` ${data.newNote}` : null}
            </div>
          ) : null}
        </div>
      </header>
      <Card className={shared.panel}>
        <nav className={styles.filters} aria-label={data.filtersLabel}>
          {data.filters.map((f) => (
            <FilterGroup key={f.name} name={f.name} links={f.links} />
          ))}
        </nav>
      </Card>
      <Card as="section" className={shared.panel}>
        {data.rows.length ? (
          <ChangeTable label={data.tableLabel} rows={data.rows} />
        ) : (
          <p className={styles.empty}>{data.empty}</p>
        )}
      </Card>
    </AccountFrame>
  );
}
