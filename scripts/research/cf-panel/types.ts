/** Shared shapes for the Cloudflare AI-crawler policy panel study. */

/** The three panel strata. Group membership is decided at panel build and re-verified every run. */
export type PanelGroup = 'cf_ads' | 'cf_no_ads' | 'ads_no_cf';

export interface PanelEntry {
  domain: string;
  /** Tranco rank in the list named by PanelFile.tranco. */
  rank: number;
  group: PanelGroup;
  /** The probe evidence the group assignment was made from, kept so it can be audited. */
  evidence: {
    /** Homepage response `server` header, verbatim, or null when absent. */
    server: string | null;
    /** Whether the homepage response carried a `cf-ray` header. */
    cfRay: boolean;
    /** Homepage HTTP status at panel build. */
    homepageStatus: number;
    /** /ads.txt HTTP status at panel build. */
    adsTxtStatus: number;
    /** Whether the /ads.txt body parsed as a plausible ads.txt (see probe.ts). */
    adsTxtValid: boolean;
  };
}

export interface PanelFile {
  /** ISO timestamp the panel was frozen at. */
  builtAt: string;
  /** Which Tranco list this was drawn from — the study is not reproducible without it. */
  tranco: { listId: string; date: string; url: string; prefix: number };
  /** Rank window candidates were sampled from, inclusive. */
  rankRange: { min: number; max: number };
  targets: Record<PanelGroup, number>;
  /** How many candidates were probed to fill the panel. */
  candidatesProbed: number;
  entries: PanelEntry[];
}

/** How a robots.txt treats one user-agent token. */
export type BotAccess =
  | 'allowed'
  | 'disallowed_root'
  | 'partially_disallowed'
  | 'unmentioned';

export interface BotAccessResult {
  token: string;
  status: BotAccess;
  /** True when some user-agent group in the file matches this token (not the `*` fallback). */
  mentioned: boolean;
  /** The user-agent group value that was selected, or '*', or null when no group applies. */
  matchedGroup: string | null;
}

export interface RobotsCapture {
  /** URL after redirects, as reported by the fetcher. */
  finalUrl: string | null;
  status: number | null;
  /** Body as stored — truncated to ROBOTS_MAX_BYTES; `truncated` says whether that happened. */
  body: string | null;
  /** sha256 of the STORED body (so a hash always describes the bytes in this file). */
  sha256: string | null;
  /** Length in bytes of the body as received, before any truncation. */
  bytes: number | null;
  truncated: boolean;
  error: string | null;
}

export interface DomainSnapshot {
  domain: string;
  group: PanelGroup;
  rank: number;
  fetchedAt: string;
  robots: RobotsCapture;
  /** Per-token access, computed from the robots body with RFC 9309 group matching. */
  access: BotAccessResult[];
  /** Content Signals lines, verbatim, in file order. */
  contentSignals: string[];
  homepage: {
    status: number | null;
    server: string | null;
    cfRay: boolean;
    error: string | null;
  };
  adsTxt: { status: number | null; error: string | null };
  /** Set when the re-verified signals no longer match the frozen group assignment. */
  groupMismatch: boolean;
}
