/**
 * Writes docs/specs/v2/30-fix-packets.md. Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx src/v2/packets/write-spec.ts
 */
import { writeFileSync } from 'node:fs';
import { formattedPacketSpec, SPEC_URL } from './spec.js';

writeFileSync(SPEC_URL, await formattedPacketSpec());
