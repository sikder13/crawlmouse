'use client';

import { Button } from '../../Button';
import { Field } from '../../Field';
import { Select } from '../../Select';
import { CLIENT_REPORTS_COPY } from '../../../../lib/v2/copy/client-reports';
import type { ClientChangeView } from '../../../../lib/v2/view/agency-reports';
import { PostForm } from '../account/PostForm';
import styles from './AgencyScreen.module.css';

const F = CLIENT_REPORTS_COPY.form;

/** The client's name, its contact address and, where the reader's records hold it, its owning seat. */
export function ClientForm({ client }: { client: ClientChangeView['client'] }) {
  return (
    <PostForm action={client.action} method={client.method} className={styles.form}>
      <h3 className={styles.legend}>{F.clientLegend}</h3>
      <Field id="client-name" label={F.name} name="clientName" defaultValue={client.name} />
      <Field
        id="client-email"
        label={F.email}
        type="email"
        name="contactEmail"
        placeholder={F.emailPlaceholder}
        defaultValue={client.email}
        autoComplete="off"
        describedBy="client-email-hint"
      />
      <p id="client-email-hint" className={styles.hint}>
        {F.emailHint}
      </p>
      {client.seats ? (
        <Select
          id="client-seat"
          label={F.seat}
          name="ownerSeatId"
          options={client.seats}
          defaultValue={client.seat}
        />
      ) : null}
      <div>
        <Button type="submit">{F.saveClient}</Button>
      </div>
    </PostForm>
  );
}

/** How often the report goes, on which weekday, at what time in which zone, and whether it goes unchanged. */
export function ScheduleForm({ schedule }: { schedule: ClientChangeView['schedule'] }) {
  return (
    <PostForm action={schedule.action} method={schedule.method} className={styles.form}>
      <h3 className={styles.legend}>{F.scheduleLegend}</h3>
      <Select
        id="schedule-cadence"
        label={F.cadence}
        name="cadence"
        options={schedule.cadences}
        defaultValue={schedule.cadence}
      />
      <Select
        id="schedule-weekday"
        label={F.weekday}
        name="isoWeekday"
        options={schedule.weekdays}
        defaultValue={schedule.weekday}
      />
      <div className={styles.stack}>
        <label htmlFor="schedule-time" className={styles.label}>
          {F.time}
        </label>
        <input
          id="schedule-time"
          type="time"
          name="timeLocal"
          className={styles.time}
          defaultValue={schedule.time}
          required
        />
      </div>
      <Select
        id="schedule-zone"
        label={F.zone}
        name="timezone"
        options={schedule.zones}
        defaultValue={schedule.zone}
      />
      <p className={styles.hint}>{F.zoneHint}</p>
      <label className={styles.check}>
        <input type="checkbox" name="sendWhenUnchanged" defaultChecked={schedule.unchanged} />
        <span>{F.unchanged}</span>
      </label>
      <div>
        <Button type="submit" variant={schedule.primary ? 'primary' : 'default'}>
          {F.saveSchedule}
        </Button>
      </div>
    </PostForm>
  );
}
