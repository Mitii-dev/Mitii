import { createHash } from 'node:crypto';

import { buildEventDedupeKey } from './fingerprint.js';
import type { AutomationEventEnvelope } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Map a GitHub webhook (or Actions `github` context dump) into a normalized
 * automation envelope. Supports workflow_run, pull_request, issues, push.
 */
export function normalizeGitHubWebhook(input: {
  headers?: Record<string, string | string[] | undefined>;
  body: unknown;
  workspaceRoot?: string;
  eventId?: string;
}): AutomationEventEnvelope | undefined {
  if (!isRecord(input.body)) return undefined;
  const body = input.body;
  const delivery =
    headerValue(input.headers, 'x-github-delivery') ??
    input.eventId ??
    asString(body.delivery_id);
  const ghEvent =
    headerValue(input.headers, 'x-github-event') ??
    asString(body.event_name) ??
    inferGitHubEventName(body);

  if (!ghEvent) return undefined;

  const action = asString(body.action);
  const eventType = action
    ? `github.${ghEvent}.${action}`
    : `github.${ghEvent}`;

  const repo =
    isRecord(body.repository) && asString(body.repository.full_name)
      ? asString(body.repository.full_name)!
      : undefined;

  let subject = repo;
  const fingerprintParts: string[] = [eventType];
  if (repo) fingerprintParts.push(repo);

  if (ghEvent === 'workflow_run' && isRecord(body.workflow_run)) {
    const run = body.workflow_run;
    const runId = run.id != null ? String(run.id) : undefined;
    const name = asString(run.name);
    const conclusion = asString(run.conclusion);
    const headSha = asString(run.head_sha);
    subject = [repo, name, runId].filter(Boolean).join('/');
    if (runId) fingerprintParts.push(runId);
    if (conclusion) fingerprintParts.push(conclusion);
    if (headSha) fingerprintParts.push(headSha);
  } else if (ghEvent === 'pull_request' && isRecord(body.pull_request)) {
    const pr = body.pull_request;
    const number = pr.number != null ? String(pr.number) : undefined;
    subject = number && repo ? `${repo}#${number}` : subject;
    if (number) fingerprintParts.push(number);
    const headSha =
      isRecord(pr.head) && asString(pr.head.sha)
        ? asString(pr.head.sha)
        : undefined;
    if (headSha) fingerprintParts.push(headSha);
  } else if (ghEvent === 'issues' && isRecord(body.issue)) {
    const issue = body.issue;
    const number = issue.number != null ? String(issue.number) : undefined;
    subject = number && repo ? `${repo}#${number}` : subject;
    if (number) fingerprintParts.push(number);
  } else if (ghEvent === 'push') {
    const after = asString(body.after);
    if (after) {
      fingerprintParts.push(after);
      subject = repo ? `${repo}@${after.slice(0, 7)}` : after;
    }
  }

  const eventId =
    delivery ??
    createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
      .slice(0, 24);

  const occurredAt =
    asString(
      isRecord(body.workflow_run) ? body.workflow_run.updated_at : undefined,
    ) ??
    asString(isRecord(body.pull_request) ? body.pull_request.updated_at : undefined) ??
    asString(body.updated_at) ??
    new Date().toISOString();

  return {
    eventId: `gh_${eventId}`,
    eventType,
    source: 'github',
    subject,
    occurredAt,
    workspaceRoot: input.workspaceRoot,
    dedupeKey: buildEventDedupeKey({
      eventType,
      source: 'github',
      subject,
      eventId,
      fingerprintParts,
    }),
    payload: body,
    attributes: {
      githubEvent: ghEvent,
      ...(action ? { action } : {}),
      ...(repo ? { repository: repo } : {}),
      ...(isRecord(body.workflow_run)
        ? {
            conclusion: asString(body.workflow_run.conclusion),
            workflowName: asString(body.workflow_run.name),
            workflowRunId:
              body.workflow_run.id != null
                ? String(body.workflow_run.id)
                : undefined,
          }
        : {}),
    },
  };
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

function inferGitHubEventName(body: Record<string, unknown>): string | undefined {
  if (isRecord(body.workflow_run)) return 'workflow_run';
  if (isRecord(body.pull_request)) return 'pull_request';
  if (isRecord(body.issue) && !isRecord(body.pull_request)) return 'issues';
  if (asString(body.ref) && (body.before || body.after)) return 'push';
  if (isRecord(body.check_run)) return 'check_run';
  if (isRecord(body.check_suite)) return 'check_suite';
  return undefined;
}
