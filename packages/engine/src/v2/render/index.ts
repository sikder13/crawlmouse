/** The render step's surface for the pipeline (CC-20). See docs/specs/v2/14-render.md. */
export { defaultAdmit, NotAdmitted, type Admit } from './admission.js';
export { CAP_ENV, capsFromEnv, type DailyBudget, type RenderCaps } from './budget.js';
export { clientFromEnv, ENV, type BrowserRunClient } from './client.js';
export { siteEstimate, type GradedPageShare, type SiteEstimate } from './estimate.js';
export {
  IN_FLIGHT_ENV,
  inFlightFromEnv,
  NOT_RENDERED,
  renderCheck,
  type NotRenderedReason,
  type RenderCheckInput,
  type RenderedPage,
  type RenderOutcome,
} from './run.js';
export { FREE_MAX_RENDERS, type RenderCandidate } from './sample.js';
