'use client';

import type { FormEvent, ReactNode } from 'react';
import { Button } from '../../Button';
import { Field } from '../../Field';
import { Select } from '../../Select';
import { SEATS_COPY } from '../../../../lib/v2/copy/seats';
import type { SeatChangeView, SeatFields, SeatsView } from '../../../../lib/v2/view/seats';
import { useLive } from '../account/LiveActions';
import styles from './SeatsScreen.module.css';

const F = SEATS_COPY.form;
const URLENCODED = 'application/x-www-form-urlencoded';

/** A POST form that submits on a live page and is inert on a preview, as `ActionControl`'s are. */
function PostForm({
  action,
  method,
  className,
  children,
}: {
  action: string;
  /** The verb an HTML form lacks, sent as `_method`. */
  method?: 'PATCH' | 'DELETE';
  className?: string;
  children: ReactNode;
}) {
  const live = useLive();
  const stop = (e: FormEvent) => e.preventDefault();
  return (
    <form
      method="post"
      action={action}
      encType={URLENCODED}
      className={className}
      onSubmit={live ? undefined : stop}
    >
      {method ? <input type="hidden" name="_method" value={method} /> : null}
      {children}
    </form>
  );
}

/** A seat's role, and which clients it covers: every one, or the boxes ticked. */
function RoleAndScope({ id, fields }: { id: string; fields: SeatFields }) {
  return (
    <>
      <Select
        id={`${id}-role`}
        label={F.role}
        name="role"
        options={fields.roles}
        defaultValue={fields.role}
      />
      <Select
        id={`${id}-scope`}
        label={F.scope}
        name="scope"
        options={fields.scope}
        defaultValue={fields.scopeValue}
      />
      {fields.sites.length ? (
        <fieldset className={styles.sites}>
          <legend className={styles.legend}>{F.someClients}</legend>
          {fields.sites.map((s) => (
            <label key={s.name} className={styles.site}>
              <input type="checkbox" name={s.name} defaultChecked={s.ticked} />
              <span className={styles.host}>{s.host}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </>
  );
}

/** The invite form. Its submit is not the orange element: the header's link to it is. */
export function InviteForm({ invite }: { invite: NonNullable<SeatsView['invite']> }) {
  return (
    <PostForm action={invite.action} className={styles.form}>
      <Field
        id="invite-email"
        label={F.email}
        type="email"
        name="email"
        placeholder={F.emailPlaceholder}
        autoComplete="off"
        required
      />
      <RoleAndScope id="invite" fields={invite.fields} />
      <div>
        <Button type="submit">{F.send}</Button>
      </div>
    </PostForm>
  );
}

/**
 * A seat's "Change": on a preview the button the locked screen draws; on a live page a disclosure
 * with the role and scope form, a new invitation for a seat not yet accepted, and the removal.
 */
export function ChangeSeat({ seat, who }: { seat: SeatChangeView; who: string }) {
  const live = useLive();
  if (!live) {
    return (
      <Button variant="quiet" size="sm">
        {SEATS_COPY.change}
      </Button>
    );
  }
  const id = `seat-${seat.change.action.split('/').pop()}`;
  return (
    <details className={styles.change}>
      <summary className={styles.summary} aria-label={`${SEATS_COPY.change} ${who}`}>
        {SEATS_COPY.change}
      </summary>
      <div className={styles.changeBody}>
        <PostForm action={seat.change.action} method="PATCH" className={styles.form}>
          <RoleAndScope id={id} fields={seat.change.fields} />
          <div>
            <Button type="submit" size="sm">
              {F.save}
            </Button>
          </div>
        </PostForm>
        {seat.resend ? (
          <PostForm action={seat.resend.action}>
            <Button type="submit" variant="quiet" size="sm">
              {seat.resend.label}
            </Button>
          </PostForm>
        ) : null}
        <PostForm action={seat.remove.action} method="DELETE">
          <Button type="submit" variant="quiet" size="sm">
            {seat.remove.label}
          </Button>
        </PostForm>
      </div>
    </details>
  );
}

/** The Agency plan's extra seats and sites: the quantities wanted, posted as absolute numbers. */
export function BuyForm({ buy }: { buy: NonNullable<SeatsView['buy']> }) {
  const B = SEATS_COPY.buy;
  return (
    <PostForm action={buy.action} className={styles.form}>
      <input type="hidden" name="accountId" value={buy.accountId} />
      <label className={styles.quantity}>
        <span>{B.seats}</span>
        <input
          type="number"
          name="seats"
          min={0}
          max={buy.seats.max}
          step={1}
          defaultValue={buy.seats.value}
          required
        />
      </label>
      <label className={styles.quantity}>
        <span>{B.sites}</span>
        <input
          type="number"
          name="sites"
          min={0}
          max={buy.sites.max}
          step={1}
          defaultValue={buy.sites.value}
          required
        />
      </label>
      <div>
        <Button type="submit">{B.submit}</Button>
      </div>
    </PostForm>
  );
}
