import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FUNNEL_EVENTS } from './analytics-events';
import { EVENT_REGISTRY, type EventName } from './analytics-registry';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The event's name as a string literal: `'x'`, `"x"` or `` `x` ``. */
const quoted = (name: string) => new RegExp(`['"\`]${name.replace(/[-]/g, '\\-')}['"\`]`);

/** The app's source files that are not tests: what the unsent check sweeps. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe('the events registry (CC-41 D6)', () => {
  const names = Object.keys(EVENT_REGISTRY);

  it('has one entry per FUNNEL_EVENTS name, and no other', () => {
    expect([...names].sort()).toEqual([...FUNNEL_EVENTS].sort());
    expect(names).toHaveLength(FUNNEL_EVENTS.length);
  });

  it('names each sender at a file that holds the event name as a literal', () => {
    for (const name of names as EventName[]) {
      for (const s of EVENT_REGISTRY[name].senders) {
        const path = join(WEB_ROOT, s.file);
        expect(existsSync(path), `${name}: ${s.file} does not exist`).toBe(true);
        expect(readFileSync(path, 'utf8'), `${name}: ${s.file}`).toMatch(quoted(name));
      }
    }
  });

  it('records an event as unsent only when no source file outside the list names it', () => {
    const files = ['app', 'components', 'lib']
      .flatMap((d) => sourceFiles(join(WEB_ROOT, d)))
      .filter(
        (f) => !f.endsWith('lib/analytics-events.ts') && !f.endsWith('lib/analytics-registry.ts'),
      );
    const texts = files.map((f) => readFileSync(f, 'utf8'));
    const unsent = (names as EventName[]).filter((n) => EVENT_REGISTRY[n].senders.length === 0);
    expect(unsent.length).toBeGreaterThan(0);
    for (const name of unsent) {
      expect(
        texts.some((t) => quoted(name).test(t)),
        `${name} is named in the source`,
      ).toBe(false);
    }
  });

  it('pairs a browser sender with the browser consent gate and id, and a server one with neither', () => {
    for (const name of names as EventName[]) {
      for (const s of EVENT_REGISTRY[name].senders) {
        if (s.side === 'browser') {
          expect(s.consent, name).toBe('browser');
          expect(s.distinctId.kind, name).toBe('browser');
        } else {
          expect(s.consent, name).not.toBe('browser');
          expect(s.distinctId.kind, name).not.toBe('browser');
        }
      }
    }
  });

  it('marks a survey trigger only where a browser sends the event', () => {
    const triggers = (names as EventName[]).filter((n) => EVENT_REGISTRY[n].surveyTrigger);
    expect(triggers.sort()).toEqual(['fix_done_confirmed', 'result_viewed']);
    for (const name of triggers) {
      expect(
        EVENT_REGISTRY[name].senders.some((s) => s.side === 'browser'),
        name,
      ).toBe(true);
    }
  });
});
