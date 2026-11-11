// @vitest-environment jsdom
/**
 * The dashboard's fix actions on a live page (CC-26b follow-up): Copy fix fetches the packet and
 * copies it as the fix page's prompt, saying so; Email to my developer shows its address field. On
 * a preview both render as before. fetch and the clipboard are fakes.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionControl } from '../../components/v2/screens/account/ActionControl';
import { LiveActions } from '../../components/v2/screens/account/LiveActions';
import { fixture } from '../../lib/v2/fixtures';
import { action } from '../../lib/v2/view/account-actions';
import { dashboardPreview } from '../../app/(v2-preview)/v2-preview/_preview/accounts';
import { packetPrompt } from '../../lib/v2/view/segment/fixes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fix = fixture('bad-site').fixes.find((f) => f.packet !== null)!;
const copyFix = action('copyFix', 'Copy fix', { id: fix.id }, { copy: true });
// The dashboard's own action, as its change rows render it.
const email = dashboardPreview('home')
  .changed.flatMap((c) => c.actions)
  .find((a) => a.route === '/api/fixes/[id]/email-developer')!;

let root: Root | null = null;
let host: HTMLDivElement;
const writeText = vi.fn(async (_: string) => undefined);

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

async function click() {
  await act(async () => {
    host.querySelector('button')!.click();
  });
  // let the fetch and the clipboard settle
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const status = () => host.querySelector('[role="status"]')?.textContent;

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('Copy fix on a live page', () => {
  it('fetches the packet and copies it as the fix page’s prompt', async () => {
    const fetchMock = answer(200, { packet: fix.packet, prompt: packetPrompt(fix, fix.packet!) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LiveActions>
        <ActionControl action={copyFix} />
      </LiveActions>,
    );
    expect(host.querySelector('a')).toBeNull();
    await click();
    expect(fetchMock).toHaveBeenCalledWith(`/api/fixes/${fix.id}/packet`, expect.any(Object));
    expect(writeText).toHaveBeenCalledWith(packetPrompt(fix, fix.packet!));
    expect(status()).toBe('Copied the fix as a prompt.');
  });

  it('a 402 says the packet is on a paid plan, and copies nothing', async () => {
    vi.stubGlobal('fetch', answer(402, { code: 'upgrade_required', gate: 'packets' }));
    render(
      <LiveActions>
        <ActionControl action={copyFix} />
      </LiveActions>,
    );
    await click();
    expect(writeText).not.toHaveBeenCalled();
    expect(status()).toBe('This fix’s packet is on a paid plan.');
  });

  it('a failed fetch, or an answer that is not a packet, says it could not be fetched', async () => {
    for (const f of [
      answer(500, {}),
      answer(200, { packet: { not: 'a packet' } }),
      vi.fn(async () => {
        throw new Error('offline');
      }),
    ]) {
      vi.stubGlobal('fetch', f);
      render(
        <LiveActions>
          <ActionControl action={copyFix} />
        </LiveActions>,
      );
      await click();
      expect(writeText).not.toHaveBeenCalled();
      expect(status()).toBe(
        'The fix could not be fetched. Try again, or open it from the site page.',
      );
      act(() => root?.unmount());
      document.body.innerHTML = '';
    }
  });

  it('a browser that refuses the clipboard is told so', async () => {
    vi.stubGlobal(
      'fetch',
      answer(200, { packet: fix.packet, prompt: packetPrompt(fix, fix.packet!) }),
    );
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(
      <LiveActions>
        <ActionControl action={copyFix} />
      </LiveActions>,
    );
    await click();
    expect(status()).toBe('This browser did not allow copying.');
  });

  it('a preview keeps the plain link', () => {
    render(<ActionControl action={copyFix} />);
    expect(host.querySelector('a')?.getAttribute('href')).toBe(`/api/fixes/${fix.id}/packet`);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});

describe('Email to my developer on a live page', () => {
  it('shows a required email field posting as `email`', () => {
    render(
      <LiveActions>
        <ActionControl action={email} />
      </LiveActions>,
    );
    const input = host.querySelector('input[name="email"]') as HTMLInputElement;
    expect(input.type).toBe('email');
    expect(input.required).toBe(true);
    expect(host.querySelector('form')!.getAttribute('action')).toBe(email.href);
  });

  it('a preview shows no field', () => {
    render(<ActionControl action={email} />);
    expect(host.querySelector('input[name="email"]')).toBeNull();
  });
});

describe('a site’s settings forms on a live page', () => {
  // Imported here so the site preview's records are read once.
  const rows = () =>
    import('../../app/(v2-preview)/v2-preview/_preview/accounts').then(
      (m) => m.sitePreview('home').settings.rows,
    );

  it('the schedule form sends its day and hour only with a timed schedule', async () => {
    const schedule = (await rows()).find((r) => r.label === 'Schedule')!.action!;
    render(
      <LiveActions>
        <ActionControl action={schedule} />
      </LiveActions>,
    );
    const form = host.querySelector('form')!;
    const sent = () => [...new FormData(form).keys()];
    expect(sent()).toEqual(['_method', 'schedule', 'dow', 'hour']);
    const cadence = form.querySelector('select[name="schedule"]') as HTMLSelectElement;
    act(() => {
      cadence.value = 'none';
      cadence.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sent()).toEqual(['_method', 'schedule']);
    expect(new FormData(form).get('schedule')).toBe('none');
  });

  it('remove asks for a ticked confirmation, posted as confirm=remove', async () => {
    const remove = (await rows()).find((r) => r.label === 'Remove this site')!.action!;
    render(
      <LiveActions>
        <ActionControl action={remove} />
      </LiveActions>,
    );
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.required).toBe(true);
    expect([box.name, box.value]).toEqual(['confirm', 'remove']);
    expect(host.querySelector('label')!.textContent).toContain('Yes, remove this site');
  });

  it('a preview renders none of these fields', async () => {
    const schedule = (await rows()).find((r) => r.label === 'Schedule')!.action!;
    render(<ActionControl action={schedule} />);
    expect(host.querySelectorAll('select, input:not([type="hidden"])')).toHaveLength(0);
  });
});

describe('the notice line', () => {
  it('takes focus when the page opens with it, so it is read out', async () => {
    const { Notice } = await import('../../components/v2/screens/account/Notice');
    render(<Notice notice={{ code: 'capped', text: 'This site has used its re-checks.' }} />);
    const p = host.querySelector('[data-v2-notice="capped"]');
    expect(p).not.toBeNull();
    expect(document.activeElement).toBe(p);
  });

  it('with no notice nothing is drawn and focus stays where it was', async () => {
    const { Notice } = await import('../../components/v2/screens/account/Notice');
    render(<Notice notice={null} />);
    expect(host.innerHTML).toBe('');
    expect(document.activeElement).toBe(document.body);
  });
});
