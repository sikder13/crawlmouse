/**
 * The restore window (owner ruling 4 on CC-33 questions Q18): `RESTORE_DAYS` is its one owner, and
 * every sentence that states the window prints it from there. The pages are built twice, once as
 * they are and once with `lib/v2/copy/restore-window.ts` giving the window another length, and on
 * each surface below the altered build shows the altered length, as a numeral and as a word, as many
 * times as today's build shows today's, and today's length no more. A window typed in a sentence,
 * "7" or "seven", stays at today's value in the altered build and fails that surface.
 *
 * The surfaces: Settings' Danger section and its delete step, the page the confirmation link opens
 * (its money lines and the state after the button), the restore page's closed-window state, the help
 * article on deleting an account, and the deletion email.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { count, numberWord } from '../../lib/v2/words';

const ALTERED = 16;

afterEach(() => {
  vi.doUnmock('@/lib/v2/copy/restore-window');
  vi.resetModules();
});

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/g, ' ');

/** The account shell's `<main>`: the rail around it prints the trial's end date, which is not the window. */
const mainOf = (html: string) => {
  const m = /<main id="account-main"[^>]*>([\s\S]*)<\/main>/.exec(html);
  if (!m) throw new Error('no account main');
  return m[1]!;
};

/** Each surface's text, built from the modules as they load now. */
async function surfaces(): Promise<Record<string, string>> {
  const { fixture } = await import('@/lib/v2/fixtures');
  const { ACCOUNT_VIEWERS } = await import('@/app/(v2-preview)/v2-preview/_preview/accounts');
  const { settingsView, deleteStepView } = await import('@/lib/v2/view/settings');
  const { DeleteScreen } = await import('@/components/v2/screens/settings/DeleteScreen');
  const { DeletionScreen } = await import('@/components/v2/screens/deletion/DeletionScreen');
  const { HelpArticleScreen } = await import('@/components/v2/screens/help/HelpScreens');
  const { helpArticleView } = await import('@/lib/v2/help/view');
  const { accountDelete } = await import('@/lib/v2/mail/templates/account-links');
  const d = fixture('bad-site');
  const token = 'a'.repeat(43);
  return {
    'Settings, Danger': settingsView(d, ACCOUNT_VIEWERS.home(), { subscriptionStatus: null }).danger
      .text,
    'Settings, the delete step': textOf(
      mainOf(
        renderToStaticMarkup(<DeleteScreen data={deleteStepView(d, ACCOUNT_VIEWERS.home())} />),
      ),
    ),
    '/account/delete': textOf(
      renderToStaticMarkup(
        <DeletionScreen
          flow="deleteConfirm"
          view={{
            ok: true,
            purgeAfter: null,
            accounts: [
              { id: 'a1', host: 'active.example', subscription: 'active' },
              { id: 'a2', host: 'late.example', subscription: 'past_due' },
            ],
          }}
        />,
      ),
    ),
    '/account/delete, after the button': textOf(
      renderToStaticMarkup(
        <DeletionScreen flow="deleteConfirm" view={{ ok: false, code: 'deleted' }} />,
      ),
    ),
    '/account/restore, window closed': textOf(
      renderToStaticMarkup(
        <DeletionScreen flow="restore" view={{ ok: false, code: 'window_closed' }} />,
      ),
    ),
    '/help/delete-account': textOf(
      renderToStaticMarkup(<HelpArticleScreen data={helpArticleView('delete-account')} />),
    ),
    'the deletion email': accountDelete({ confirmToken: token, restoreToken: token }).text,
  };
}

async function alteredSurfaces(): Promise<Record<string, string>> {
  vi.resetModules();
  vi.doMock('@/lib/v2/copy/restore-window', () => ({ RESTORE_DAYS: ALTERED }));
  return surfaces();
}

/** How many times `n` is on `text`: as a numeral, and as its word. */
const times = (text: string, n: number) => ({
  numeral: (text.match(new RegExp(`(?<![\\d,.])${count(n)}(?![\\d,])`, 'g')) ?? []).length,
  word: (text.match(new RegExp(`\\b${numberWord(n)}\\b`, 'gi')) ?? []).length,
});

describe('the restore window has one owner (ruling 4, Q18)', () => {
  it('Settings’ grace and the deletion copy’s window are the same constant', async () => {
    const { DELETE_GRACE_DAYS } = await import('../../lib/v2/copy/settings');
    const { RESTORE_DAYS } = await import('../../lib/v2/copy/deletion');
    expect(DELETE_GRACE_DAYS).toBe(RESTORE_DAYS);
    const altered = await alteredSurfaces();
    expect(Object.keys(altered).length).toBeGreaterThan(0);
    const settings = await import('@/lib/v2/copy/settings');
    const deletion = await import('@/lib/v2/copy/deletion');
    expect([settings.DELETE_GRACE_DAYS, deletion.RESTORE_DAYS]).toEqual([ALTERED, ALTERED]);
  });

  it('the altered length is not on today’s surfaces, as a numeral or a word', async () => {
    const today = await surfaces();
    const { RESTORE_DAYS } = await import('../../lib/v2/copy/restore-window');
    expect(RESTORE_DAYS).not.toBe(ALTERED);
    expect(numberWord(ALTERED)).not.toBe(count(ALTERED));
    expect(numberWord(RESTORE_DAYS)).not.toBe(count(RESTORE_DAYS));
    for (const [name, text] of Object.entries(today))
      expect(times(text, ALTERED), name).toEqual({ numeral: 0, word: 0 });
  });

  it('each surface shows the altered length where it showed today’s, and today’s no more', async () => {
    const today = await surfaces();
    const { RESTORE_DAYS } = await import('../../lib/v2/copy/restore-window');
    const altered = await alteredSurfaces();
    expect(Object.keys(altered)).toEqual(Object.keys(today));
    for (const name of Object.keys(today)) {
      const before = times(today[name]!, RESTORE_DAYS);
      expect(before.numeral + before.word, `${name} states the window today`).toBeGreaterThan(0);
      expect(times(altered[name]!, ALTERED), name).toEqual(before);
      expect(times(altered[name]!, RESTORE_DAYS), name).toEqual({ numeral: 0, word: 0 });
    }
  });

  it('the surfaces state the window both as a numeral and as a word (anti-vacuity)', async () => {
    const today = Object.values(await surfaces()).join('\n');
    const { RESTORE_DAYS } = await import('../../lib/v2/copy/restore-window');
    const shown = times(today, RESTORE_DAYS);
    expect(shown.numeral).toBeGreaterThan(0);
    expect(shown.word).toBeGreaterThan(0);
  });
});
