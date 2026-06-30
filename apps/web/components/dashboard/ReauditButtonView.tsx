import type { Ref } from 'react';
import { type TurnstileInstance } from '@marsidev/react-turnstile';
import { Button } from '../ui/Button';
import { Turnstile } from '@/components/ui/Turnstile';

// Pure presentation for ReauditButton, split out so the VISIBLE half of FIX 1 — surfacing a non-200
// as an inline alert, showing the on-demand captcha, and the disabled states — is unit-tested via
// renderToStaticMarkup (this suite has no DOM/testing-library). The fetch→outcome→state wiring lives
// in ReauditButton; the decision is the pure reauditOutcome.
export function ReauditButtonView({
  running,
  error,
  captchaRequired,
  disabled,
  onReaudit,
  onToken,
  widgetRef,
}: {
  running: boolean;
  error: string | null;
  captchaRequired: boolean;
  disabled: boolean;
  onReaudit: () => void;
  onToken: (token: string | null) => void;
  widgetRef: Ref<TurnstileInstance | undefined>;
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" size="sm" onClick={onReaudit} loading={running} disabled={disabled}>
        Re-audit
      </Button>
      {captchaRequired && <Turnstile ref={widgetRef} onToken={onToken} />}
      {error && (
        <p role="alert" className="max-w-[16rem] text-right text-caption text-warning">
          {error}
        </p>
      )}
    </div>
  );
}
