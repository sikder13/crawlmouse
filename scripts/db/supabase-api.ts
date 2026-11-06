import { MANAGEMENT_API } from './db';

/**
 * The few Management API calls the workflows make: preview branches, a branch's database password,
 * and a project's pooler host. Every secret this module reads is registered with `mask` before it
 * is returned, so GitHub Actions redacts it from any later log line.
 */

export interface Branch {
  id: string;
  name: string;
  /** The branch's own project ref. */
  project_ref: string;
  /** The branch's build: CREATING_PROJECT, RUNNING_MIGRATIONS, MIGRATIONS_PASSED, ... */
  status: string;
  /** The branch project's health: COMING_UP, ACTIVE_HEALTHY, ... */
  preview_project_status?: string;
}

/** One run of Supabase's branch workflow, and its steps (configure, migrate, pull, deploy, ...). */
export interface ActionRun {
  id: string;
  created_at: string;
  run_steps: Array<{ name: string; status: string }>;
}

interface BranchDetail {
  ref: string;
  db_pass?: string;
}

interface PoolerConfig {
  database_type: string;
  db_user: string;
  db_host: string;
  db_name: string;
}

/** Registers a value with GitHub Actions' log redaction. Outside Actions it does nothing. */
export function mask(value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.GITHUB_ACTIONS === 'true' && value) process.stdout.write(`::add-mask::${value}\n`);
}

export class ManagementApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${MANAGEMENT_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    const text = await res.text();
    try {
      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      // The parser's message quotes the input, which may hold a password.
      throw new Error(`${method} ${path}: the response is not JSON`);
    }
  }

  listBranches(projectRef: string): Promise<Branch[]> {
    return this.call('GET', `/v1/projects/${projectRef}/branches`);
  }

  createBranch(projectRef: string, name: string): Promise<Branch> {
    return this.call('POST', `/v1/projects/${projectRef}/branches`, { branch_name: name });
  }

  async deleteBranch(branchRef: string): Promise<void> {
    await this.call('DELETE', `/v1/branches/${branchRef}`);
  }

  /** The branch's workflow runs. Its run is listed under the branch's own project ref. */
  listActionRuns(branchRef: string): Promise<ActionRun[]> {
    return this.call('GET', `/v1/projects/${branchRef}/actions`);
  }

  /**
   * A run's log, or null when Supabase has none. Every branch read on 2026-11-06 answered HTTP 400,
   * "The specified log stream does not exist", so the dry run does not depend on it.
   */
  async actionRunLog(branchRef: string, runId: string): Promise<string | null> {
    const res = await this.fetchImpl(
      `${MANAGEMENT_API}/v1/projects/${branchRef}/actions/${runId}/logs`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    return res.ok ? await res.text() : null;
  }

  getBranch(branchRef: string): Promise<BranchDetail> {
    return this.call('GET', `/v1/branches/${branchRef}`);
  }

  async branchPassword(branchRef: string): Promise<string> {
    const { db_pass } = await this.getBranch(branchRef);
    if (!db_pass)
      throw new Error(`the Management API returned no database password for ${branchRef}`);
    mask(db_pass);
    return db_pass;
  }

  /**
   * A session-mode pooler URL (port 5432) for a project. GitHub's runners have no IPv6 route, and
   * the direct host `db.<ref>.supabase.co` resolves to IPv6 only, so the pooler is the way in.
   */
  async poolerUrl(projectRef: string, password: string): Promise<string> {
    const configs = await this.call<PoolerConfig[]>(
      'GET',
      `/v1/projects/${projectRef}/config/database/pooler`,
    );
    const primary = configs.find((c) => c.database_type === 'PRIMARY') ?? configs[0];
    if (!primary) throw new Error(`no pooler is configured for ${projectRef}`);
    const url = new URL('postgresql://placeholder');
    url.username = primary.db_user;
    url.password = password;
    url.hostname = primary.db_host;
    url.port = '5432';
    url.pathname = `/${primary.db_name}`;
    url.searchParams.set('sslmode', 'require');
    const text = url.toString();
    mask(text);
    mask(url.password);
    mask(encodeURIComponent(password));
    return text;
  }
}

/**
 * Polls the parent's branch list until the branch's project is up and healthy, or fails on a failed
 * status or at the deadline. It does not mean the history has been replayed onto the branch: that
 * is still running when the branch first reports healthy (see waitForReplay).
 */
export async function waitForBranch(
  api: ManagementApi,
  parentRef: string,
  branchRef: string,
  { timeoutMs = 15 * 60_000, intervalMs = 10_000, log = console.log } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const branch = (await api.listBranches(parentRef)).find((b) => b.project_ref === branchRef);
    if (!branch) throw new Error(`branch ${branchRef} is not in ${parentRef}'s branch list`);
    const state = `${branch.status} / ${branch.preview_project_status ?? 'unknown'}`;
    if (state !== last) log(`branch ${branchRef}: ${state}`);
    last = state;
    if (branch.status.endsWith('_FAILED')) {
      throw new Error(`branch ${branchRef} failed to build: ${branch.status}`);
    }
    const built = branch.status === 'MIGRATIONS_PASSED' || branch.status === 'FUNCTIONS_DEPLOYED';
    if (built && branch.preview_project_status === 'ACTIVE_HEALTHY') return;
    if (Date.now() > deadline)
      throw new Error(`branch ${branchRef} still ${state} at the deadline`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Where Supabase's replay of the history onto a new branch stands. */
export interface ReplayState {
  /** Every step of the newest run had finished, a replay step among them, on two polls in a row. */
  settled: boolean;
  /** Steps that finished DEAD, Supabase's status for a failed step. */
  failed: string[];
  /** The newest run's steps as `name=STATUS`, in the order listed. */
  steps: string;
}

// Supabase's step statuses: EXITED succeeded, DEAD failed, PAUSED finished with a warning or was
// skipped. CREATED and RUNNING have not finished.
const FINISHED = new Set(['EXITED', 'DEAD', 'PAUSED']);

/**
 * Waits for Supabase to finish replaying the parent's migration history onto a branch. The branch
 * reports FUNCTIONS_DEPLOYED and ACTIVE_HEALTHY before its replay has run (measured on 2026-11-06:
 * the branch held 41 of 43 history rows when that status was first read, and all 43 three seconds
 * later), so the branch's status is not enough. A step can also go from RUNNING back to CREATED, so
 * a finished-looking run counts only when it is seen twice in a row. Returns the state at the end
 * instead of throwing: the dry run's replay step decides, and names what failed.
 */
export async function waitForReplay(
  api: Pick<ManagementApi, 'listActionRuns'>,
  branchRef: string,
  {
    timeoutMs = 10 * 60_000,
    intervalMs = 5_000,
    log = console.log,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = {},
): Promise<ReplayState> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let finishedBefore = '';
  for (;;) {
    const runs = await api.listActionRuns(branchRef);
    const newest = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const stepList = newest?.run_steps ?? [];
    const steps = stepList.map((s) => `${s.name}=${s.status}`).join(' ');
    if (steps !== last) log(`branch ${branchRef} replay: ${steps || 'no run yet'}`);
    last = steps;
    const finished =
      stepList.some((s) => s.name === 'migrate') && stepList.every((s) => FINISHED.has(s.status));
    if (finished && steps === finishedBefore) {
      const failed = stepList.filter((s) => s.status === 'DEAD').map((s) => s.name);
      return { settled: true, failed, steps };
    }
    finishedBefore = finished ? steps : '';
    if (Date.now() >= deadline) return { settled: false, failed: [], steps };
    await sleep(intervalMs);
  }
}
