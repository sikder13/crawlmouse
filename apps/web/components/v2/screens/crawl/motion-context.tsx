'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LOG_LINE_GAP_MS, prefersReducedMotion, type MotionEntry } from '../../../../lib/v2/motion';

interface MotionGate {
  /** False until the screen has painted once: what is there on arrival does not animate in. */
  ready: boolean;
  /** When a fetch-log line last slid in; lines faster than four a second appear in place. */
  lastLogLine: { current: number };
}

const Gate = createContext<MotionGate>({ ready: false, lastLogLine: { current: -Infinity } });

export function MotionGateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const lastLogLine = useRef(-Infinity);
  useEffect(() => setReady(true), []);
  return <Gate.Provider value={{ ready, lastLogLine }}>{children}</Gate.Provider>;
}

const RISE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px)' },
  { opacity: 1, transform: 'none' },
];

/**
 * Wraps something that appears on a state change and fades it in once, rising 6 px. Nothing moves
 * under reduced motion, for what was already there when the screen arrived, or for a log line that
 * follows the last within LOG_LINE_GAP_MS. The wrapper's markup is the same either way.
 */
export function Enter({
  motion,
  as: Tag = 'div',
  logLine = false,
  className,
  children,
  ...rest
}: {
  motion: MotionEntry;
  as?: 'div' | 'li' | 'span';
  logLine?: boolean;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string>) {
  const { ready, lastLogLine } = useContext(Gate);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!ready || !ref.current || prefersReducedMotion()) return;
    if (logLine) {
      const now = performance.now();
      if (now - lastLogLine.current < LOG_LINE_GAP_MS) return;
      lastLogLine.current = now;
    }
    ref.current.animate(RISE, { duration: motion.duration_ms, easing: motion.easing });
    // Only on mount: a key change remounts the element, which is the state change.
  }, []);
  return (
    <Tag ref={ref as never} className={className} {...rest}>
      {children}
    </Tag>
  );
}
