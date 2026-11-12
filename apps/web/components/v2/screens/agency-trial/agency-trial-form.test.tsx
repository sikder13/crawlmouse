/**
 * The Agency trial form's refusal line (CC-29 D3, correctness N4): a refused trial shows the reason
 * `trialRefusal` gave, the string itself; any other refusal its own sentence.
 */
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FREE_START, trialRefusal } from '../../../../lib/billing/state-machine';
import { AGENCY_TRIAL_COPY as COPY } from '../../../../lib/v2/copy/agency-trial';
import {
  agencyTrialView,
  type AgencyTrialForm as FormView,
} from '../../../../lib/v2/view/agency-trial';
import { AgencyTrialForm, type TrialFormState } from './AgencyTrialForm';

const NOW = new Date('2026-11-12T12:00:00Z');
const view = agencyTrialView(
  {
    email: 'me@summit.agency',
    interval: 'month',
    timeZone: 'UTC',
    standing: { held: false, billing: [], used: null, open: null },
    customers: new Map(),
    cancelAsked: null,
  },
  NOW,
) as FormView;

const alertOf = (initial: TrialFormState) =>
  new JSDOM(
    renderToStaticMarkup(<AgencyTrialForm view={view} initial={initial} />),
  ).window.document.querySelector('[role="alert"]')!.textContent;

describe('the refusal line', () => {
  // Each reason the state machine gives, from the state machine itself.
  const reasons = [
    { ...FREE_START, trialUsedAt: NOW },
    { ...FREE_START, disputedAt: NOW },
    { ...FREE_START, subscriptionId: 'sub_1' },
    { ...FREE_START, state: 'pro' as const, tier: 'pro' as const },
  ].map((s) => trialRefusal(s, NOW)!);

  it.each(reasons)('trial_refused shows the reason "%s" itself', (reason) => {
    expect(alertOf({ error: 'trial_refused', reason })).toBe(reason);
  });

  it('the reasons differ, so a fixed sentence could not show each', () => {
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('trial_refused without a reason, and every other code, shows its own sentence', () => {
    expect(alertOf({ error: 'trial_refused' })).toBe(COPY.errors.failed);
    expect(alertOf({ error: 'trial_used' })).toBe(COPY.errors.trial_used);
    expect(alertOf({ error: 'nonsense' })).toBe(COPY.errors.failed);
    expect(alertOf('idle')).toBe('');
  });
});
