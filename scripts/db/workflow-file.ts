import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT } from './files';

// The `yaml` package parses YAML 1.2 (core schema) by default, where the key `on` is the string "on",
// as GitHub reads it. A YAML 1.1 parser reads an unquoted `on` as the boolean true, so a check that looked
// for the key "on" would find nothing there and could pass a workflow it never read.

export const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

export const GUARD_NAME = 'Only the owner, dispatching from main';

export type Step = { name?: string; uses?: string; run?: string; env?: Record<string, unknown> };
export type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string | { name?: string };
  permissions?: unknown;
  uses?: string;
  steps?: Step[];
  [key: string]: unknown;
};
export type Workflow = {
  on?: unknown;
  env?: unknown;
  jobs: Record<string, Job>;
  [key: string]: unknown;
};

export function parseWorkflow(text: string): Workflow {
  return parse(text) as Workflow;
}

export function readWorkflow(file: string): Workflow {
  return parseWorkflow(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'));
}

export function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

/** The events a workflow's `on:` names, in any spelling GitHub accepts: a string, a list or a map. */
export function triggerEvents(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on !== null && typeof on === 'object') return Object.keys(on);
  return [];
}

/**
 * Problems with a workflow that must start only from a manual dispatch; empty when there are none.
 * Reads every top-level key, so a second spelling of `on` (a YAML 1.1 `true:` key) is not missed.
 */
export function dispatchOnlyProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  const keys = Object.keys(workflow);
  const triggerKeys = keys.filter((k) => k === 'on' || k === 'true');
  if (triggerKeys.length !== 1 || triggerKeys[0] !== 'on') {
    problems.push(`the trigger keys are [${triggerKeys.join(', ')}], not exactly [on]`);
  }
  const events = triggerEvents(workflow.on);
  if (events.length !== 1 || events[0] !== 'workflow_dispatch') {
    problems.push(`the events are [${events.join(', ')}], not exactly [workflow_dispatch]`);
  }
  return problems;
}

export function needsOf(job: Job): string[] {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

export function environmentName(job: Job): string | undefined {
  const env = job.environment;
  if (env === undefined) return undefined;
  return typeof env === 'string' ? env : env.name;
}

/** True when anything in the value, at any depth, mentions the `secrets` context. */
export function mentionsSecrets(value: unknown): boolean {
  return /\bsecrets\b/.test(JSON.stringify(value ?? null));
}
