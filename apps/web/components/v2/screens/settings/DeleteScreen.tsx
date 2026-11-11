import { Button } from '../../Button';
import { Card } from '../../Card';
import type { DeleteStepView } from '../../../../lib/v2/view/settings';
import { AccountFrame } from '../account/AccountFrame';
import { ActionControl } from '../account/ActionControl';
import { CardHead } from '../account/parts';
import field from '../../Field.module.css';
import shared from '../account/AccountScreen.module.css';
import { StoppedForm } from './StoppedForm';
import styles from './SettingsScreen.module.css';

/**
 * The step “Delete…” opens (owner ruling 12): what deleting removes, the hostname to type again,
 * and the request for a confirmation link. No orange element: the page's one action is deleting,
 * which the Settings artboard draws as a quiet control, never as the screen's best action.
 */
export function DeleteScreen({ data }: { data: DeleteStepView }) {
  const { header, field: f, submit } = data;
  const hint = `${f.id}-hint`;
  return (
    <AccountFrame shell={data.shell} currentIs="location">
      <header className={shared.header}>
        <div>
          <h1 className={shared.title}>{header.title}</h1>
          <div className={shared.line}>{header.line}</div>
        </div>
      </header>
      <Card as="section" className={shared.panel}>
        <CardHead title={data.cardTitle} sub={data.text} />
        {submit === null ? (
          <div className={styles.form}>
            <div className={shared.actions}>
              <ActionControl action={data.back} variant="quiet" size="md" />
            </div>
          </div>
        ) : (
          <StoppedForm action={submit.href} className={styles.form}>
            {Object.entries(submit.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {data.removes ? <p className={styles.hint}>{data.removes}</p> : null}
            <p className={styles.hint}>{data.steps}</p>
            <div className={field.stack}>
              <label htmlFor={f.id} className={field.label}>
                {f.label}
              </label>
              <input
                id={f.id}
                name={f.name}
                type="text"
                required
                autoComplete="off"
                spellCheck={false}
                aria-describedby={hint}
                className={`${field.input} ${styles.input}`}
              />
              <div id={hint} className={styles.hint}>
                {f.hint}
              </div>
            </div>
            <div className={shared.actions}>
              <Button type="submit">{submit.label}</Button>
              <ActionControl action={data.back} variant="quiet" size="md" />
            </div>
          </StoppedForm>
        )}
      </Card>
    </AccountFrame>
  );
}
