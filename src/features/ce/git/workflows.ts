import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

export interface WorkflowDiscovery {
  name: string;
  path: string;
  triggers: string[];
  jobs: string[];
  permissions: unknown;
  environments: string[];
  calledWorkflows: string[];
  majorExternalActions: string[];
}

export interface WorkflowFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
}

export function discoverGitHubWorkflows(workspace: string): WorkflowDiscovery[] {
  const dir = join(workspace, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => /\.ya?ml$/i.test(entry))
    .map((entry) => {
      const relPath = `.github/workflows/${entry}`;
      const fullPath = join(workspace, relPath);
      const parsed = parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown> | null;
      const jobs = isRecord(parsed?.jobs) ? Object.keys(parsed.jobs) : [];
      return {
        name: typeof parsed?.name === 'string' ? parsed.name : entry,
        path: relPath,
        triggers: extractTriggers(parsed?.on),
        jobs,
        permissions: parsed?.permissions,
        environments: extractEnvironments(parsed?.jobs),
        calledWorkflows: extractCalledWorkflows(parsed?.jobs),
        majorExternalActions: extractExternalActions(parsed?.jobs),
      };
    });
}

export function analyzeGitHubWorkflow(content: string, path = '.github/workflows/workflow.yml'): WorkflowFinding[] {
  const findings: WorkflowFinding[] = [];
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = parse(content) as Record<string, unknown> | null;
  } catch (error) {
    return [{ severity: 'error', code: 'invalid_yaml', message: error instanceof Error ? error.message : String(error), path }];
  }
  if (!parsed) return [{ severity: 'error', code: 'empty_workflow', message: 'Workflow file is empty.', path }];
  if (!parsed.permissions) findings.push({ severity: 'warning', code: 'missing_permissions', message: 'Workflow has no top-level permissions block.', path });
  if (JSON.stringify(parsed.permissions).includes('write-all')) findings.push({ severity: 'error', code: 'excessive_permissions', message: 'Workflow grants write-all permissions.', path });
  if (extractTriggers(parsed.on).includes('pull_request_target')) findings.push({ severity: 'error', code: 'pull_request_target_risk', message: 'pull_request_target can expose secrets to untrusted code.', path });
  const jobs = isRecord(parsed.jobs) ? parsed.jobs : {};
  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = isRecord(rawJob) ? rawJob : {};
    if (!job['timeout-minutes']) findings.push({ severity: 'warning', code: 'missing_timeout', message: `Job ${jobName} has no timeout-minutes.`, path });
    if (!parsed.concurrency && !job.concurrency) findings.push({ severity: 'info', code: 'missing_concurrency', message: `Job ${jobName} has no concurrency control.`, path });
    const needs = Array.isArray(job.needs) ? job.needs : typeof job.needs === 'string' ? [job.needs] : [];
    for (const need of needs) if (!jobs[String(need)]) findings.push({ severity: 'error', code: 'invalid_job_dependency', message: `Job ${jobName} needs undefined job ${need}.`, path });
    for (const step of extractSteps(job)) {
      const uses = typeof step.uses === 'string' ? step.uses : '';
      if (uses && isThirdPartyAction(uses) && !/@[a-f0-9]{40}$/i.test(uses) && !/@v\d+(?:\.\d+\.\d+)?$/i.test(uses)) {
        findings.push({ severity: 'warning', code: 'unpinned_action', message: `${uses} is not pinned to a major version or commit SHA.`, path });
      }
      const run = typeof step.run === 'string' ? step.run : '';
      if (/\$\{\{\s*github\.event\.(?:pull_request|issue|comment|head_commit)/i.test(run)) {
        findings.push({ severity: 'warning', code: 'command_injection_risk', message: `Step in ${jobName} interpolates event data into a shell command.`, path });
      }
      if (/secrets\./i.test(run)) findings.push({ severity: 'warning', code: 'secret_exposure_risk', message: `Step in ${jobName} references secrets in shell commands.`, path });
      if (/node-version:\s*['"]?(1[0-7])\b/i.test(JSON.stringify(step))) findings.push({ severity: 'warning', code: 'unsupported_node', message: `Step in ${jobName} appears to use an old Node.js version.`, path });
    }
  }
  return findings;
}

export function workflowMayAffectProduction(workflow: WorkflowDiscovery | string): boolean {
  const text = typeof workflow === 'string' ? workflow : JSON.stringify(workflow);
  return /\b(production|prod|deploy|release|publish|migration|database|npm publish|docker push)\b/i.test(text);
}

function extractTriggers(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.map(String);
  if (isRecord(value)) return Object.keys(value);
  return [];
}

function extractEnvironments(jobs: unknown): string[] {
  if (!isRecord(jobs)) return [];
  return Object.values(jobs).flatMap((job) => {
    if (!isRecord(job)) return [];
    const env = job.environment;
    if (typeof env === 'string') return [env];
    if (isRecord(env) && typeof env.name === 'string') return [env.name];
    return [];
  });
}

function extractCalledWorkflows(jobs: unknown): string[] {
  if (!isRecord(jobs)) return [];
  return Object.values(jobs).flatMap((job) => isRecord(job) && typeof job.uses === 'string' ? [job.uses] : []);
}

function extractExternalActions(jobs: unknown): string[] {
  if (!isRecord(jobs)) return [];
  const actions: string[] = [];
  for (const job of Object.values(jobs)) {
    if (!isRecord(job)) continue;
    for (const step of extractSteps(job)) {
      if (typeof step.uses === 'string' && isThirdPartyAction(step.uses)) actions.push(step.uses);
    }
  }
  return actions;
}

function extractSteps(job: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(job.steps) ? job.steps.filter(isRecord) : [];
}

function isThirdPartyAction(uses: string): boolean {
  return /^[^./][^/]+\/[^@/]+@/.test(uses);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
