// Run as a CHILD PROCESS by fetcher.test.ts. Its whole job is to leave the event loop with nothing
// in it but the deadline timer: if that timer is unref'd, Node exits here silently and prints
// nothing, which is the failure that killed sixteen panel builds. A test inside a live process
// cannot see this, because the test runner's own loop is busy.
import { withDeadline } from '../fetcher.js';

try {
  await withDeadline(() => new Promise<never>(() => {}), 300, 'child');
  console.log('RESOLVED');
} catch {
  console.log('REJECTED');
}
