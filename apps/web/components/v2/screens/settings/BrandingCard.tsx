'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  brandBody,
  brandLogoAlt,
  brandOutcome,
  type BrandingCardView,
  type BrandOutcome,
} from '../../../../lib/v2/view/brand-card';
import { Button } from '../../Button';
import { Card } from '../../Card';
import { useLive } from '../account/LiveActions';
import { CardHead } from '../account/parts';
import field from '../../Field.module.css';
import shared from '../account/AccountScreen.module.css';
import styles from './SettingsScreen.module.css';

type State = 'idle' | 'sending' | BrandOutcome;

/**
 * Settings' Branding card (Goal 1 row 24): the brand name, the current logo, and a logo file. Save
 * posts both as multipart to the brand route, which decides; its refusal is shown under the field it
 * is about, or under Save. A preview renders without `LiveActions` and posts nothing.
 *
 * The form has no `action` and Save stays disabled until the page has hydrated, so nothing can
 * post the form natively to the JSON route: without JavaScript the reader sees the card and its
 * current brand, and cannot save.
 */
export function BrandingCard({ view }: { view: BrandingCardView }) {
  const live = useLive();
  const [state, setState] = useState<State>('idle');
  const [logo, setLogo] = useState(view.logo.current);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // A logo shown from a chosen file is an object URL: revoked when it is replaced, and on unmount.
  useEffect(() => {
    const src = logo?.src;
    return () => {
      if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
    };
  }, [logo?.src]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!live || state === 'sending') return;
    const name = nameRef.current?.value ?? '';
    const file = fileRef.current?.files?.[0] ?? null;
    setState('sending');
    try {
      const res = await fetch(view.href, { method: 'POST', body: brandBody(name, file) });
      const body: unknown = await res.json().catch(() => null);
      const outcome = brandOutcome(res.status, body, view.messages);
      if (outcome.ok) {
        if (nameRef.current) nameRef.current.value = outcome.agencyName;
        const alt = brandLogoAlt(outcome.agencyName);
        setLogo((was) =>
          file !== null && file.size > 0
            ? { src: URL.createObjectURL(file), alt }
            : was === null
              ? null
              : { ...was, alt },
        );
        if (fileRef.current) fileRef.current.value = '';
      }
      setState(outcome);
      // A refusal about a field moves the reader to it, so its error, tied by aria-describedby, is read.
      if (!outcome.ok && outcome.field === 'name') nameRef.current?.focus();
      if (!outcome.ok && outcome.field === 'logo') fileRef.current?.focus();
    } catch {
      setState({ ok: false, field: null, text: view.messages.failed });
    }
  }

  const failed = typeof state === 'object' && !state.ok ? state : null;
  const errorOn = (f: 'name' | 'logo' | null) => (failed?.field === f ? failed.text : null);
  const nameError = errorOn('name');
  const logoError = errorOn('logo');
  const formLine =
    typeof state !== 'object' ? '' : state.ok ? view.messages.saved : (errorOn(null) ?? '');
  const formLink = failed?.field === null ? (failed.link ?? null) : null;
  const ids = {
    nameHint: `${view.name.id}-hint`,
    nameError: `${view.name.id}-error`,
    logoHint: `${view.logo.id}-hint`,
    logoError: `${view.logo.id}-error`,
    current: `${view.logo.id}-current`,
  };

  return (
    <div data-v2-addition="">
      <Card as="section" className={shared.panel}>
        <CardHead title={view.title} sub={view.sub} />
        <form className={styles.form} aria-label={view.title} onSubmit={submit} noValidate>
          <div className={field.stack}>
            <label htmlFor={view.name.id} className={field.label}>
              {view.name.label}
            </label>
            <input
              ref={nameRef}
              id={view.name.id}
              name={view.name.field}
              type="text"
              autoComplete="organization"
              defaultValue={view.name.value}
              required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${ids.nameHint} ${ids.nameError}` : ids.nameHint}
              className={`${field.input} ${styles.input} ${styles.text}`}
            />
            <div id={ids.nameHint} className={styles.hint}>
              {view.name.hint}
            </div>
            {nameError ? (
              <div id={ids.nameError} className={styles.fieldError}>
                {nameError}
              </div>
            ) : null}
          </div>

          <div className={field.stack}>
            <span id={ids.current} className={field.label}>
              {view.logo.currentLabel}
            </span>
            <div className={styles.logoBox} aria-labelledby={ids.current} role="group">
              {logo ? (
                <img src={logo.src} alt={logo.alt} className={styles.logo} />
              ) : (
                <span className={styles.hint}>{view.logo.none}</span>
              )}
            </div>
          </div>

          <div className={field.stack}>
            <label htmlFor={view.logo.id} className={field.label}>
              {view.logo.label}
            </label>
            <input
              ref={fileRef}
              id={view.logo.id}
              name={view.logo.field}
              type="file"
              accept={view.logo.accept}
              aria-invalid={logoError ? true : undefined}
              aria-describedby={logoError ? `${ids.logoHint} ${ids.logoError}` : ids.logoHint}
              className={styles.file}
            />
            <div id={ids.logoHint} className={styles.hint}>
              {view.logo.hint}
            </div>
            {logoError ? (
              <div id={ids.logoError} className={styles.fieldError}>
                {logoError}
              </div>
            ) : null}
          </div>

          <div>
            <Button type="submit" disabled={!hydrated || state === 'sending'}>
              {state === 'sending' ? view.save.busy : view.save.label}
            </Button>
          </div>
          <p className={styles.formLine} role="status">
            {formLine}
            {formLink ? (
              <>
                {' '}
                <a href={formLink.href} className={styles.inlineLink}>
                  {formLink.label}
                </a>
              </>
            ) : null}
          </p>
        </form>
      </Card>
    </div>
  );
}
