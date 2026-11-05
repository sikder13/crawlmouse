/**
 * Prints the runner probe's result as one JSON line, for the visual job's retry decision
 * (scripts/perf-retry.sh) and the nightly summary.
 */
import { probe } from './probe.js';

process.stdout.write(`${JSON.stringify(probe())}\n`);
