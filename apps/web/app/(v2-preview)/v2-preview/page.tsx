import { Heading, PageShell } from '../../../components/v2';
import { PREVIEWS } from './_preview/registry';
import styles from './_preview/PreviewFrame.module.css';

export default function V2PreviewIndex() {
  const groups = [
    { title: 'Primitives', items: PREVIEWS.filter((p) => p.kind === 'primitive') },
    { title: 'Reference screens', items: PREVIEWS.filter((p) => p.kind === 'screen') },
  ];
  return (
    <PageShell header="app" footer={false}>
      <main className={styles.main}>
        <Heading level={1} size="m">
          v2 design system
        </Heading>
        {groups.map((g) => (
          <section key={g.title} className={styles.section}>
            <Heading level={2} size="s">
              {g.title}
            </Heading>
            <ul>
              {g.items.map((p) => (
                <li key={p.path}>
                  <a href={p.path}>{p.name}</a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </PageShell>
  );
}
