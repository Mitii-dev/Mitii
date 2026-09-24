/**
 * Serialize automation specs to the same markdown format reconcile parses.
 * Desktop / CLI / VS Code share this so file specs stay the source of truth.
 */

import type { DeliveryTarget } from '../delivery/types.js';
import type {
  AutomationAgentMode,
  AutomationAutonomyPreset,
  TriggerKind,
} from '../types.js';

export interface SerializeCronMarkdownInput {
  name: string;
  title?: string;
  prompt: string;
  triggerKind: TriggerKind;
  cron?: string | null;
  timezone?: string | null;
  eventType?: string | null;
  /** Flat filter map → `filter.<key>:` lines. */
  filters?: Record<string, unknown> | null;
  filtersJson?: string | null;
  debounceSeconds?: number | null;
  dedupeWindowSeconds?: number | null;
  cooldownSeconds?: number | null;
  mode?: AutomationAgentMode | null;
  autonomyPreset?: AutomationAutonomyPreset | null;
  timeoutSeconds?: number | null;
  maxParallel?: number | null;
  enabled?: boolean;
  workspaceRoot?: string | null;
  /** Delivery targets stored in metadata_json by ClaimRunner. */
  delivery?: DeliveryTarget[] | null;
  /** Opaque desktop canvas layout / mapping extras. */
  desktopFlow?: Record<string, unknown> | null;
  /** Extra metadata keys merged into metadata JSON frontmatter. */
  metadata?: Record<string, unknown> | null;
}

function yamlScalar(value: string): string {
  if (/[:#{}[\],&*?|<>=!%@`']/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function filterLines(filters: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    const rendered =
      typeof value === 'string' ? yamlScalar(value) : JSON.stringify(value);
    lines.push(`filter.${key}: ${rendered}`);
  }
  return lines;
}

/**
 * Build `.cron.md` / `.event.md` content compatible with `parseCronMarkdown`.
 */
export function serializeCronMarkdown(input: SerializeCronMarkdownInput): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${yamlScalar(input.name.trim())}`);
  if (input.title?.trim() && input.title.trim() !== input.name.trim()) {
    lines.push(`title: ${yamlScalar(input.title.trim())}`);
  }

  if (input.triggerKind === 'event') {
    lines.push('trigger: event');
    if (!input.eventType?.trim()) {
      throw new Error('event specs require eventType');
    }
    lines.push(`event: ${yamlScalar(input.eventType.trim())}`);
  } else if (input.triggerKind === 'manual') {
    lines.push('trigger: manual');
  } else if (input.triggerKind === 'one_off') {
    lines.push('trigger: one_off');
  } else {
    if (!input.cron?.trim()) {
      throw new Error('schedule specs require cron');
    }
    lines.push(`cron: ${JSON.stringify(input.cron.trim())}`);
    if (input.timezone?.trim()) {
      lines.push(`timezone: ${yamlScalar(input.timezone.trim())}`);
    }
  }

  if (input.mode) lines.push(`mode: ${input.mode}`);
  if (input.autonomyPreset) {
    lines.push(`autonomyPreset: ${input.autonomyPreset}`);
  }
  if (input.timeoutSeconds != null) {
    lines.push(`timeoutSeconds: ${input.timeoutSeconds}`);
  }
  if (input.maxParallel != null) {
    lines.push(`maxParallel: ${input.maxParallel}`);
  }
  if (input.debounceSeconds != null) {
    lines.push(`debounceSeconds: ${input.debounceSeconds}`);
  }
  if (input.dedupeWindowSeconds != null) {
    lines.push(`dedupeWindowSeconds: ${input.dedupeWindowSeconds}`);
  }
  if (input.cooldownSeconds != null) {
    lines.push(`cooldownSeconds: ${input.cooldownSeconds}`);
  }
  if (input.workspaceRoot?.trim()) {
    lines.push(`workspace: ${yamlScalar(input.workspaceRoot.trim())}`);
  }
  lines.push(`enabled: ${input.enabled === false ? 'false' : 'true'}`);

  let filters = input.filters ?? null;
  if (!filters && input.filtersJson?.trim()) {
    try {
      const parsed = JSON.parse(input.filtersJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        filters = parsed as Record<string, unknown>;
      }
    } catch {
      lines.push(`filtersJson: ${JSON.stringify(input.filtersJson.trim())}`);
    }
  }
  if (filters) {
    lines.push(...filterLines(filters));
  }

  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
  };
  if (input.delivery && input.delivery.length > 0) {
    metadata.delivery = input.delivery;
  }
  if (input.desktopFlow && Object.keys(input.desktopFlow).length > 0) {
    metadata.desktopFlow = input.desktopFlow;
  }
  if (Object.keys(metadata).length > 0) {
    lines.push(`metadata: ${JSON.stringify(metadata)}`);
  }

  lines.push('---', '', input.prompt.trim(), '');
  return lines.join('\n');
}
