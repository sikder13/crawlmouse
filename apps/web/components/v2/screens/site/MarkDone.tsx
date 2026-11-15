'use client';

import type { FormEvent } from 'react';
import posthog from 'posthog-js';
import { track } from '../../../../lib/analytics';
import type { ActionView } from '../../../../lib/v2/view/account-actions';
import { ActionControl } from '../account/ActionControl';
import { useLive } from '../account/LiveActions';

/**
 * Whether the page Mark done's form was sent back to says the mark stands: `marked_done`, or one of
 * the `marked_done_*` notices of a mark whose re-check was not queued (lib/v2/account/fixes.ts;
 * MarkDone.dom.test.tsx holds the two lists together).
 */
export function markStood(pageUrl: string): boolean {
  const notice = new URL(pageUrl).searchParams.get('notice') ?? '';
  return notice === 'marked_done' || notice.startsWith('marked_done_');
}

const capturing = () => posthog.__loaded && !posthog.has_opted_out_capturing();

/**
 * A fix row's Mark done (an addition to the locked page), on a live page only.
 *
 * While PostHog runs and capture is not opted out, the form is sent with fetch, which follows the
 * route's 303 to the site's page; when that page's notice says the mark stands, the browser event
 * `fix_done_confirmed {type}` is captured (a survey trigger, CC-41 D8), and the browser then goes to
 * that page, as the form would have. An answer that is not a redirect reloads the page, and a fetch
 * that fails sends the form itself. Otherwise the form posts as it always has.
 */
export function MarkDone({ action, fixType }: { action: ActionView; fixType: string }) {
  const live = useLive();
  if (!live) return null;
  const submit = async (e: FormEvent<HTMLElement>) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !capturing()) return;
    e.preventDefault();
    let res: Response;
    try {
      // Form-encoded, as the form itself posts, so the route answers it as a form.
      const fields = [...new FormData(form)].map(([k, v]) => [k, String(v)]);
      res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(fields) });
    } catch {
      form.submit();
      return;
    }
    if (!res.redirected) {
      window.location.reload();
      return;
    }
    if (res.ok && markStood(res.url)) track('fix_done_confirmed', { type: fixType });
    window.location.assign(res.url);
  };
  return (
    <span data-v2-addition="" onSubmit={submit}>
      <ActionControl action={action} variant="quiet" />
    </span>
  );
}
