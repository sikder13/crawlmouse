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
    return (text ? JSON.parse(text) : undefined) as T;
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
    return text;
  }
}

/**
 * Polls the parent's branch list until the branch's migrations have run and its project is healthy,
 * or fails on a failed status or at the deadline.
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
