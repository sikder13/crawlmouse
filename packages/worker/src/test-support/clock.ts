import type { Clock } from '../clock.js';

/**
 * A clock whose sleeps return at once and move time forward by the amount slept. With one sleeper at
 * a time (one batch per site in a test), the limiter's pacing plays out in virtual time exactly as it
 * would in real time, without the wait.
 */
export class InstantClock implements Clock {
  constructor(private t = 1_700_000_000_000) {}

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.t += Math.max(0, ms);
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
