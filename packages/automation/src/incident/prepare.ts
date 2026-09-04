import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildIncidentFingerprint,
  formatIncidentIssueBody,
  formatIncidentIssueTitle,
  pullGithubActionsLogs,
  writeEvidencePack,
} from './evidence.js';
import type { AutomationEventLogRecord } from '../events/types.js';
import { resolveAutomationReportsDir } from '../paths.js';

/**
 * Given a trigger event (typically github.workflow_run.*), pull CI logs and
 * write an evidence pack next to automation artifacts.
 */
export function prepareIncidentEvidence(input: {
  dbPath: string;
  runId: string;
  workspaceRoot: string;
  event: AutomationEventLogRecord;
}): {
  extraFiles: string[];
  evidenceDir: string;
  fingerprint: string;
  suggestedIssueTitle: string;
  suggestedIssueBody: string;
} {
  const artifactsRoot = join(
    resolveAutomationReportsDir(input.dbPath),
    '..',
    'artifacts',
    input.runId,
  );
  mkdirSync(artifactsRoot, { recursive: true });

  let attrs: Record<string, unknown> = {};
  try {
    attrs = input.event.attributesJson
      ? (JSON.parse(input.event.attributesJson) as Record<string, unknown>)
      : {};
  } catch {
    attrs = {};
  }

  const workflowRunId =
    typeof attrs.workflowRunId === 'string'
      ? attrs.workflowRunId
      : undefined;
  const repository =
    typeof attrs.repository === 'string' ? attrs.repository : undefined;
  const workflowName =
    typeof attrs.workflowName === 'string' ? attrs.workflowName : undefined;
  const conclusion =
    typeof attrs.conclusion === 'string' ? attrs.conclusion : undefined;

  const fingerprint = buildIncidentFingerprint([
    input.event.eventType,
    repository ?? '',
    workflowName ?? '',
    workflowRunId ?? input.event.dedupeKey ?? input.event.eventId,
    conclusion ?? '',
  ]);

  const extraFiles: string[] = [];
  if (workflowRunId) {
    const pulled = pullGithubActionsLogs({
      runId: workflowRunId,
      repository,
      workspaceRoot: input.workspaceRoot,
      outDir: artifactsRoot,
    });
    if (pulled.ok && pulled.logPath) {
      extraFiles.push(pulled.logPath);
    }
  }

  const summary = [
    `Event ${input.event.eventType} for ${input.event.subject ?? repository ?? 'unknown'}`,
    conclusion ? `Conclusion: ${conclusion}` : '',
    workflowName ? `Workflow: ${workflowName}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const pack = writeEvidencePack({
    outDir: artifactsRoot,
    title: workflowName ?? 'incident',
    fingerprint,
    summary,
    eventJson: input.event.payloadJson,
    logPaths: extraFiles,
  });
  extraFiles.push(pack.manifestPath);

  return {
    extraFiles,
    evidenceDir: pack.dir,
    fingerprint,
    suggestedIssueTitle: formatIncidentIssueTitle({
      fingerprint,
      workflowName,
      repository,
      conclusion,
    }),
    suggestedIssueBody: formatIncidentIssueBody({
      fingerprint,
      summary,
      evidenceDir: pack.dir,
      eventType: input.event.eventType,
    }),
  };
}
