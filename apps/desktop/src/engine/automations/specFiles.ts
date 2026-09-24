/**
 * Persist AutomationFlowDocument → workspace `.mitii/cron` markdown.
 * Reconcile picks files up — same path as CLI `mitii serve`.
 */

import { mkdirSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  resolveWorkspaceCronDir,
  serializeCronMarkdown,
} from '@mitii/automation';

import {
  deliveryTargetsFromFlow,
  triggerKindFromFlow,
  type AutomationFlowDocument,
} from '../../shared/automations/flow.js';

export function flowFilePath(
  workspaceRoot: string,
  flow: AutomationFlowDocument,
): string {
  const cronDir = resolveWorkspaceCronDir(workspaceRoot);
  const safeId = flow.id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '');
  if (flow.trigger.kind === 'event') {
    return join(cronDir, 'events', `${safeId}.event.md`);
  }
  return join(cronDir, `${safeId}.cron.md`);
}

export function writeFlowSpecFile(
  workspaceRoot: string,
  flow: AutomationFlowDocument,
): { path: string } {
  const path = flowFilePath(workspaceRoot, flow);
  mkdirSync(dirname(path), { recursive: true });

  const trigger = flow.trigger;
  const delivery = deliveryTargetsFromFlow(flow.delivery);
  const raw = serializeCronMarkdown({
    name: flow.title.trim() || flow.id,
    title: flow.title.trim() && flow.title.trim() !== flow.id ? flow.title : undefined,
    prompt: flow.agent.prompt,
    triggerKind: triggerKindFromFlow(trigger),
    cron: trigger.kind === 'schedule' ? trigger.cron : null,
    timezone: trigger.kind === 'schedule' ? trigger.timezone ?? null : null,
    eventType: trigger.kind === 'event' ? trigger.eventType : null,
    filters: trigger.kind === 'event' ? trigger.filters ?? null : null,
    debounceSeconds:
      trigger.kind === 'event' ? trigger.debounceSeconds ?? null : null,
    dedupeWindowSeconds:
      trigger.kind === 'event' ? trigger.dedupeWindowSeconds ?? null : null,
    cooldownSeconds:
      trigger.kind === 'event' ? trigger.cooldownSeconds ?? null : null,
    mode: flow.agent.mode,
    autonomyPreset: flow.agent.autonomyPreset,
    timeoutSeconds: flow.agent.timeoutSeconds ?? null,
    maxParallel: flow.agent.maxParallel ?? null,
    enabled: flow.enabled,
    workspaceRoot,
    delivery,
    desktopFlow: {
      schemaVersion: flow.schemaVersion,
      schema: flow.schema,
      layout: flow.layout,
      steps: flow.steps,
      variables: flow.variables ?? [],
      connections: flow.connections,
      agent: {
        mapping: flow.agent.mapping ?? {},
        agentId: flow.agent.agentId,
        profileId: flow.agent.profileId,
        model: flow.agent.model,
        repository: flow.agent.repository,
        contextPaths: flow.agent.contextPaths ?? [],
        mcpServerIds: flow.agent.mcpServerIds ?? [],
        skillIds: flow.agent.skillIds ?? [],
        recipeIds: flow.agent.recipeIds ?? [],
      },
    },
  });

  writeFileSync(path, raw, 'utf8');
  return { path };
}

export function removeFlowSpecFile(
  workspaceRoot: string,
  flowOrPath: AutomationFlowDocument | string,
): void {
  const path =
    typeof flowOrPath === 'string'
      ? flowOrPath
      : flowFilePath(workspaceRoot, flowOrPath);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
