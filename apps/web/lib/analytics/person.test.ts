import { describe, expect, it } from 'vitest';
import type { FirstTouch } from './first-touch';
import {
  identifyPerson,
  PERSON_SET_KEYS,
  personSet,
  type PersonPostHog,
  type PersonTraits,
  type TraitsSource,
} from './person';

const USER = 'u0000000-0000-4000-8000-000000000001';
const OTHER = 'u0000000-0000-4000-8000-000000000002';

const traits: PersonTraits = {
  userId: USER,
  set: {
    account_id: 'a0000000-0000-4000-8000-000000000001',
    plan: 'pro_trial',
    internal: false,
    checks_finished: 2,
    account_age_days: 3,
    trial_day: 4,
  },
};

type Call = [string, ...unknown[]];

function fakePostHog(state: { optedOut?: boolean; distinctId?: string; identified?: boolean }) {
  const calls: Call[] = [];
  const ph: PersonPostHog = {
    has_opted_out_capturing: () => state.optedOut ?? false,
    get_distinct_id: () => state.distinctId ?? 'anon-device-id',
    get_property: (name) =>
      name === '$user_state' ? (state.identified ? 'identified' : 'anonymous') : undefined,
    reset: () => void calls.push(['reset']),
    identify: (id, set, setOnce) => void calls.push(['identify', id, set, setOnce]),
  };
  return { ph, calls };
}

describe('identifyPerson', () => {
  it('identifies an anonymous browser as the user, with the allowed traits', () => {
    const { ph, calls } = fakePostHog({});
    identifyPerson(ph, traits, null);
    expect(calls).toEqual([['identify', USER, traits.set, {}]]);
  });

  it('makes no call at all while capture is opted out', () => {
    const { ph, calls } = fakePostHog({ optedOut: true, identified: true, distinctId: OTHER });
    identifyPerson(ph, traits, null);
    expect(calls).toEqual([]);
  });

  it('resets first when the browser is identified as someone else', () => {
    const { ph, calls } = fakePostHog({ identified: true, distinctId: OTHER });
    identifyPerson(ph, traits, null);
    expect(calls.map((c) => c[0])).toEqual(['reset', 'identify']);
  });

  it('does not reset when the browser is already this user', () => {
    const { ph, calls } = fakePostHog({ identified: true, distinctId: USER });
    identifyPerson(ph, traits, null);
    expect(calls.map((c) => c[0])).toEqual(['identify']);
  });

  it('does not reset an anonymous browser, so its events merge into the person', () => {
    const { ph, calls } = fakePostHog({ identified: false, distinctId: 'anon-device-id' });
    identifyPerson(ph, traits, null);
    expect(calls.map((c) => c[0])).toEqual(['identify']);
  });

  it('sets the first touch once, every field prefixed ft_', () => {
    const { ph, calls } = fakePostHog({});
    const ft: FirstTouch = {
      utm_source: 'linkedin',
      utm_term: 'ai crawlers',
      referrer_host: 'www.linkedin.com',
      landing_path: '/blog/x',
      ref: 'abc',
      first_seen_at: '2026-11-15T15:04:05Z',
    };
    identifyPerson(ph, traits, ft);
    expect(calls[0]![3]).toEqual({
      ft_utm_source: 'linkedin',
      ft_utm_term: 'ai crawlers',
      ft_referrer_host: 'www.linkedin.com',
      ft_landing_path: '/blog/x',
      ft_ref: 'abc',
      ft_first_seen_at: '2026-11-15T15:04:05Z',
    });
  });

  it('never sets an email or a name, whatever the caller passes', () => {
    const { ph, calls } = fakePostHog({});
    const forged = {
      ...traits,
      set: { ...traits.set, email: 'someone@example.com', name: 'Someone', $email: 'x@y.z' },
    } as unknown as PersonTraits;
    const ftForged = {
      first_seen_at: '2026-11-15T15:04:05Z',
      email: 'someone@example.com',
    } as unknown as FirstTouch;
    identifyPerson(ph, forged, ftForged);
    const [, , set, setOnce] = calls[0]!;
    expect(Object.keys(set as object).sort()).toEqual([...PERSON_SET_KEYS].sort());
    expect(setOnce).toEqual({ ft_first_seen_at: '2026-11-15T15:04:05Z' });
    expect(JSON.stringify(calls)).not.toMatch(/someone|Someone|x@y\.z/);
  });

  it('the allowlist is exactly the six traits', () => {
    expect([...PERSON_SET_KEYS]).toEqual([
      'account_id',
      'plan',
      'internal',
      'checks_finished',
      'account_age_days',
      'trial_day',
    ]);
  });
});

describe('personSet', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-11-20T12:00:00Z');
  const source = (over: Partial<TraitsSource> = {}): TraitsSource => ({
    accountId: 'a1',
    state: 'pro_trial',
    stateHistory: [
      { state: 'free', since: '2026-11-01T09:00:00Z' },
      { state: 'pro_trial', since: '2026-11-10T13:00:00Z' },
    ],
    internal: false,
    checksFinished: 5,
    ...over,
  });

  it('reads the plan as the account state, the age in whole days, and the trial day from 1', () => {
    expect(personSet(source(), now)).toEqual({
      account_id: 'a1',
      plan: 'pro_trial',
      internal: false,
      checks_finished: 5,
      account_age_days: 19,
      trial_day: 10,
    });
  });

  it('counts day 1 as the first 24 hours of the trial', () => {
    const start = new Date(now.getTime() - DAY + 1).toISOString();
    expect(
      personSet(source({ stateHistory: [{ state: 'pro_trial', since: start }] }), now).trial_day,
    ).toBe(1);
    const later = new Date(now.getTime() - DAY).toISOString();
    expect(
      personSet(source({ stateHistory: [{ state: 'pro_trial', since: later }] }), now).trial_day,
    ).toBe(2);
  });

  it('reads the Agency trial (card required) as a trial too', () => {
    const s = source({
      state: 'agency_trial',
      stateHistory: [
        { state: 'free', since: '2026-11-01T09:00:00Z' },
        { state: 'agency_trial', since: '2026-11-19T12:00:00Z' },
      ],
    });
    expect(personSet(s, now)).toMatchObject({ plan: 'agency_trial', trial_day: 2 });
  });

  it('a second trial counts from its own start', () => {
    const s = source({
      stateHistory: [
        { state: 'pro_trial', since: '2026-11-01T12:00:00Z' },
        { state: 'free', since: '2026-11-05T12:00:00Z' },
        { state: 'pro_trial', since: '2026-11-18T12:00:00Z' },
      ],
    });
    expect(personSet(s, now).trial_day).toBe(3);
  });

  it.each(['free', 'pro', 'agency', 'past_due'] as const)('has no trial day on %s', (state) => {
    expect(personSet(source({ state }), now).trial_day).toBeNull();
  });
});
