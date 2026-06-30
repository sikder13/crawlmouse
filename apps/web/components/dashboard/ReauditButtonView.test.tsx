import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReauditButtonView } from './ReauditButtonView';

const base = {
  running: false,
  error: null as string | null,
  captchaRequired: false,
  disabled: false,
  onReaudit: () => {},
  onToken: () => {},
  widgetRef: () => {}, // a callback ref satisfies Ref<TurnstileInstance | undefined>
};

describe('ReauditButtonView', () => {
  it('renders the one-tap re-audit button', () => {
    const html = renderToStaticMarkup(<ReauditButtonView {...base} />);
    expect(html).toContain('Re-audit');
    expect(html).toContain('<button');
  });

  it('SURFACES a non-200 as an inline alert (the whole point of FIX 1 — never silent)', () => {
    const html = renderToStaticMarkup(
      <ReauditButtonView {...base} error="We’re at capacity right now — please try again tomorrow." />,
    );
    expect(html).toContain('We’re at capacity right now — please try again tomorrow.');
    expect(html).toContain('role="alert"');
  });

  it('shows no alert region when there is no error', () => {
    expect(renderToStaticMarkup(<ReauditButtonView {...base} error={null} />)).not.toContain('role="alert"');
  });

  it('disables the button when asked (captcha pending without a token, or running)', () => {
    expect(renderToStaticMarkup(<ReauditButtonView {...base} disabled />)).toContain('disabled');
  });
});
