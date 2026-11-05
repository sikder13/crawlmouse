/**
 * The two caps on browser time, read from the environment, and the daily budget the caller keeps.
 *
 * Both caps fail closed: a variable that is unset, empty or not a whole number of seconds reads as zero,
 * and a zero cap renders nothing. The per-day cap is shared by every check, so its count lives with the
 * caller (CC-20 wires the store); the engine only asks it to reserve and settle.
 */

export const CAP_ENV = {
  perCheck: 'RENDER_MAX_BROWSER_SECONDS_PER_CHECK',
  perDay: 'RENDER_MAX_BROWSER_SECONDS_PER_DAY',
} as const;

export interface RenderCaps {
  perCheckMs: number;
  perDayMs: number;
}

function secondsAsMs(value: string | undefined): number {
  const v = value?.trim() ?? '';
  return /^[0-9]+$/.test(v) ? Number(v) * 1000 : 0;
}

export function capsFromEnv(env: Record<string, string | undefined>): RenderCaps {
  return {
    perCheckMs: secondsAsMs(env[CAP_ENV.perCheck]),
    perDayMs: secondsAsMs(env[CAP_ENV.perDay]),
  };
}

export interface DailyBudget {
  /** Reserve `ms` of today's browser time: false when that would pass today's cap. */
  reserve(ms: number): Promise<boolean>;
  /** Close a reservation of `reservedMs` that used `usedMs`, giving back or adding the difference. */
  settle(reservedMs: number, usedMs: number): Promise<void>;
}
