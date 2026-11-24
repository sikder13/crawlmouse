import { describe, expect, it } from 'vitest';
import { RISK_FEATURES, featureShown, hiddenFeatures, shownFeatures } from './feature-switch';

const hide = (value: string | undefined) => ({ V2_HIDE_FEATURES: value });

describe('the one switch that hides an unproven feature (Goal 1, rule 2)', () => {
  it('unset, every feature shows: nothing changes until a feature is named', () => {
    for (const f of RISK_FEATURES) expect(featureShown(f, hide(undefined)), f).toBe(true);
    expect(featureShown('competitors', {})).toBe(true);
  });

  it('hides exactly the features named, and no other', () => {
    const env = hide('competitors,staging_deploys');
    expect(RISK_FEATURES.filter((f) => !featureShown(f, env))).toEqual([
      'competitors',
      'staging_deploys',
    ]);
  });

  it.each([
    [' competitors , nojs ', ['nojs', 'competitors']],
    ['COMPETITORS', ['competitors']],
    ['competitors,,competitors', ['competitors']],
    ['', []],
  ])('reads %j as hiding %j', (value, hidden) => {
    const env = hide(value);
    expect(RISK_FEATURES.filter((f) => !featureShown(f, env)).sort()).toEqual([...hidden].sort());
  });

  it('reports a name that is no feature, so a typo cannot silently show what it meant to hide', () => {
    expect(hiddenFeatures(hide('competitor,nojs')).unknown).toEqual(['competitor']);
    expect(featureShown('competitors', hide('competitor'))).toBe(true);
  });

  it('names a key that is an object property as unknown, not as a feature', () => {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      expect(hiddenFeatures(hide(key)).unknown).toEqual([key]);
    }
  });

  it('gives a screen every feature’s state at once, as plain booleans a client component can take', () => {
    const shown = shownFeatures(hide('sentinel'));
    expect(Object.keys(shown).sort()).toEqual([...RISK_FEATURES].sort());
    expect(shown.sentinel).toBe(false);
    expect(shown.competitors).toBe(true);
    expect(JSON.parse(JSON.stringify(shown))).toEqual(shown);
  });

  it('holds one name per RISK row of Goal 1', () => {
    expect([...RISK_FEATURES].sort()).toEqual(
      [
        'ai_letter',
        'nojs',
        'pages_2000',
        'rendering',
        'competitors',
        'staging_deploys',
        'sentinel',
        'agency_white_label',
        'agency_domain',
      ].sort(),
    );
  });
});
