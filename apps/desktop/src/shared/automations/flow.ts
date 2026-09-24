/**
 * Desktop automation flow document — Trigger → Command → Agent.
 *
 * Specs stay in `.mitii/cron` (`@mitii/automation`). Desktop stores layout
 * and attachments in frontmatter `metadata.desktopFlow`.
 *
 * Schema: mitii.automation.flow/v1
 */

import type {
  AutomationAgentMode,
  AutomationAutonomyPreset,
  DeliveryAdapter,
  DeliveryTarget,
  TriggerKind,
} from '@mitii/automation';

export const AUTOMATION_FLOW_SCHEMA = 'mitii.automation.flow/v1' as const;

export type FlowNodeKind = 'trigger' | 'step' | 'agent' | 'delivery';

export type FlowStepKind =
  | 'index'
  | 'review'
  | 'command'
  | 'recipe'
  | 'mcp'
  | 'hook'
  | 'context'
  | 'skill';

export interface FlowNodePosition {
  x: number;
  y: number;
}

export type FlowTriggerConfig =
  | {
      kind: 'schedule';
      cron: string;
      timezone?: string;
    }
  | {
      kind: 'event';
      eventType: string;
      filters?: Record<string, unknown>;
      debounceSeconds?: number;
      dedupeWindowSeconds?: number;
      cooldownSeconds?: number;
    }
  | {
      kind: 'manual';
    }
  | {
      kind: 'one_off';
    };

export interface FlowAgentConfig {
  mode: AutomationAgentMode;
  autonomyPreset: AutomationAutonomyPreset;
  /** Message sent to the agent (same idea as the chat composer). */
  prompt: string;
  /** Desktop profile id. Empty = active profile at run time. */
  profileId?: string;
  /** Model id for this run. Empty = the profile's current model. */
  model?: string;
  /** Workspace path this flow targets. Empty = engine workspace. */
  repository?: string;
  /** Pinned files or folders relative to the repository. */
  contextPaths?: string[];
  /** MCP server ids already configured in Desktop. */
  mcpServerIds?: string[];
  /** Skill ids from the Desktop catalog. */
  skillIds?: string[];
  /** Recipe ids Mitii already provides. */
  recipeIds?: string[];
  /** Optional agent file id under .mitii/agents/<id>.md */
  agentId?: string;
  timeoutSeconds?: number;
  maxParallel?: number;
  /** Prompt template variable map (event payload → {{key}}). */
  mapping?: Record<string, string>;
}

/**
 * Host steps that run before the agent. Command output is appended to the
 * agent message when `passOutput` is true.
 */
export type FlowStepConfig =
  | {
      id: string;
      kind: 'index';
      label?: string;
    }
  | {
      id: string;
      kind: 'review';
      label?: string;
      /** Optional path globs / relative paths to focus. */
      paths?: string[];
    }
  | {
      id: string;
      kind: 'command';
      label?: string;
      /** Shell-safe argv (no shell interpolation). */
      argv: string[];
      timeoutSeconds?: number;
      failOnError?: boolean;
      /** When true (default), stdout/stderr are passed to the next module. */
      passOutput?: boolean;
    }
  | {
      id: string;
      kind: 'recipe';
      label?: string;
      /** Recipe / playbook id under .mitii/recipes or Desktop catalog. */
      recipeId: string;
    }
  | {
      id: string;
      kind: 'mcp';
      label?: string;
      serverId: string;
      toolName?: string;
      /** Optional JSON-serializable args template. */
      args?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: 'hook';
      label?: string;
      hookKind: 'post-commit' | 'pre-push' | 'custom';
      hookId?: string;
    }
  | {
      id: string;
      kind: 'skill';
      label?: string;
      skillId: string;
    };

export interface FlowDeliveryConfig {
  id: string;
  adapter: DeliveryAdapter;
  target: string;
  metadata?: Record<string, unknown>;
}

export type FlowEndpoint =
  | { kind: 'trigger' }
  | { kind: 'agent' }
  | { kind: 'step'; id: string }
  | { kind: 'delivery'; id: string };

export interface FlowConnection {
  id: string;
  from: FlowEndpoint;
  to: FlowEndpoint;
}

export interface FlowVariable {
  id: string;
  key: string;
  value: string;
}

export interface AutomationFlowDocument {
  schemaVersion: 1;
  schema: typeof AUTOMATION_FLOW_SCHEMA;
  /** Stable id → filename stem + externalId. */
  id: string;
  title: string;
  enabled: boolean;
  trigger: FlowTriggerConfig;
  /** Ordered deterministic steps between trigger and agent. */
  steps: FlowStepConfig[];
  agent: FlowAgentConfig;
  delivery: FlowDeliveryConfig[];
  /** Named values substituted as {{key}} in the agent message. */
  variables?: FlowVariable[];
  /**
   * Wires between nodes. Omitted on older flows — derived from step order
   * until the user edits a wire.
   */
  connections?: FlowConnection[];
  layout: {
    trigger: FlowNodePosition;
    agent: FlowNodePosition;
    steps: Record<string, FlowNodePosition>;
    delivery: Record<string, FlowNodePosition>;
  };
}

export const DEFAULT_FLOW_LAYOUT = {
  trigger: { x: 48, y: 140 },
  agent: { x: 420, y: 140 },
  steps: {} as Record<string, FlowNodePosition>,
  delivery: {} as Record<string, FlowNodePosition>,
} as const;

export function createEmptyFlow(
  partial?: Partial<Pick<AutomationFlowDocument, 'id' | 'title'>>,
): AutomationFlowDocument {
  const id =
    partial?.id?.trim() ||
    `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    schemaVersion: 1,
    schema: AUTOMATION_FLOW_SCHEMA,
    id,
    title: partial?.title?.trim() || 'New automation',
    enabled: true,
    trigger: {
      kind: 'manual',
    },
    steps: [],
    agent: {
      mode: 'agent',
      autonomyPreset: 'apply',
      prompt: 'If tests are missing for this change, write them.',
      mapping: {},
      contextPaths: [],
      mcpServerIds: [],
      skillIds: [],
      recipeIds: [],
    },
    variables: [],
    delivery: [],
    layout: {
      trigger: { ...DEFAULT_FLOW_LAYOUT.trigger },
      agent: { ...DEFAULT_FLOW_LAYOUT.agent },
      steps: {},
      delivery: {},
    },
  };
}

export function createFlowStep(kind: FlowStepKind): FlowStepConfig {
  const id = `step_${kind}_${Date.now().toString(36)}`;
  if (kind === 'index') {
    return { id, kind: 'index', label: 'Reindex workspace' };
  }
  if (kind === 'review') {
    return { id, kind: 'review', label: 'Prepare review context' };
  }
  if (kind === 'recipe') {
    return { id, kind: 'recipe', label: 'Run recipe', recipeId: '' };
  }
  if (kind === 'mcp') {
    return {
      id,
      kind: 'mcp',
      label: 'MCP',
      serverId: '',
    };
  }
  if (kind === 'skill') {
    return { id, kind: 'skill', label: 'Skill', skillId: '' };
  }
  if (kind === 'hook') {
    return {
      id,
      kind: 'hook',
      label: 'Workspace hook',
      hookKind: 'post-commit',
    };
  }
  return {
    id,
    kind: 'command',
    label: 'Run command',
    argv: ['npm', 'run', 'test'],
    timeoutSeconds: 600,
    failOnError: false,
    passOutput: true,
  };
}

export function defaultStepPosition(index: number): FlowNodePosition {
  return { x: 240, y: 60 + index * 110 };
}

export function triggerKindFromFlow(
  trigger: FlowTriggerConfig,
): TriggerKind {
  return trigger.kind;
}

export function deliveryTargetsFromFlow(
  delivery: FlowDeliveryConfig[],
): DeliveryTarget[] {
  return delivery
    .filter((d) => d.target.trim().length > 0)
    .map((d) => ({
      adapter: d.adapter,
      target: d.target.trim(),
      ...(d.metadata ? { metadata: d.metadata } : {}),
    }));
}

export function flowFromSpecRecord(input: {
  externalId: string;
  title: string;
  enabled: boolean;
  triggerKind: string;
  scheduleExpr?: string | null;
  timezone?: string | null;
  eventType?: string | null;
  filtersJson?: string | null;
  debounceSeconds?: number | null;
  dedupeWindowSeconds?: number | null;
  cooldownSeconds?: number | null;
  mode?: string | null;
  autonomyPreset?: string | null;
  prompt?: string | null;
  timeoutSeconds?: number | null;
  maxParallel?: number | null;
  metadataJson?: string | null;
  sourcePath?: string | null;
}): AutomationFlowDocument {
  const meta = parseMetadata(input.metadataJson);
  const desktopFlow = (meta.desktopFlow ?? {}) as Partial<AutomationFlowDocument>;
  const deliveryRaw = Array.isArray(meta.delivery) ? meta.delivery : [];
  const delivery: FlowDeliveryConfig[] = deliveryRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const adapter = String(row.adapter ?? 'webhook') as DeliveryAdapter;
      const target = String(row.target ?? '');
      if (!target) return null;
      return {
        id: String(row.id ?? `dlv_${index}`),
        adapter,
        target,
        ...(row.metadata && typeof row.metadata === 'object'
          ? { metadata: row.metadata as Record<string, unknown> }
          : {}),
      };
    })
    .filter((x): x is FlowDeliveryConfig => Boolean(x));

  const idFromPath = flowIdFromSourcePath(input.sourcePath);
  const flowId = idFromPath || input.externalId;

  let trigger: FlowTriggerConfig;
  if (input.triggerKind === 'event') {
    let filters: Record<string, unknown> | undefined;
    if (input.filtersJson?.trim()) {
      try {
        filters = JSON.parse(input.filtersJson) as Record<string, unknown>;
      } catch {
        filters = undefined;
      }
    }
    trigger = {
      kind: 'event',
      eventType: input.eventType ?? 'github.push',
      filters,
      debounceSeconds: input.debounceSeconds ?? undefined,
      dedupeWindowSeconds: input.dedupeWindowSeconds ?? undefined,
      cooldownSeconds: input.cooldownSeconds ?? undefined,
    };
  } else if (input.triggerKind === 'manual') {
    trigger = { kind: 'manual' };
  } else if (input.triggerKind === 'one_off') {
    trigger = { kind: 'one_off' };
  } else {
    trigger = {
      kind: 'schedule',
      cron: input.scheduleExpr ?? '0 9 * * *',
      timezone: input.timezone ?? undefined,
    };
  }

  const layoutFromMeta = desktopFlow.layout;
  const steps = normalizeSteps(desktopFlow.steps);
  return {
    schemaVersion: 1,
    schema: AUTOMATION_FLOW_SCHEMA,
    id: flowId,
    title: input.title,
    enabled: input.enabled,
    trigger,
    steps,
    agent: {
      mode: (input.mode as AutomationAgentMode) || 'agent',
      autonomyPreset:
        (input.autonomyPreset as AutomationAutonomyPreset) || 'apply',
      prompt: input.prompt ?? '',
      timeoutSeconds: input.timeoutSeconds ?? undefined,
      maxParallel: input.maxParallel ?? undefined,
      mapping: agentField(desktopFlow.agent, 'mapping') as
        | Record<string, string>
        | undefined,
      agentId: stringField(desktopFlow.agent, 'agentId'),
      profileId: stringField(desktopFlow.agent, 'profileId'),
      repository: stringField(desktopFlow.agent, 'repository'),
      contextPaths: stringList(desktopFlow.agent, 'contextPaths'),
      mcpServerIds: stringList(desktopFlow.agent, 'mcpServerIds'),
      skillIds: stringList(desktopFlow.agent, 'skillIds'),
      recipeIds: stringList(desktopFlow.agent, 'recipeIds'),
      model: stringField(desktopFlow.agent, 'model'),
    },
    variables: normalizeVariables(desktopFlow.variables),
    connections: normalizeConnections(desktopFlow.connections),
    delivery,
    layout: {
      trigger: layoutFromMeta?.trigger ?? { ...DEFAULT_FLOW_LAYOUT.trigger },
      agent: layoutFromMeta?.agent ?? { ...DEFAULT_FLOW_LAYOUT.agent },
      steps: {
        ...(layoutFromMeta?.steps ?? {}),
        ...Object.fromEntries(
          steps.map((s, i) => [
            s.id,
            layoutFromMeta?.steps?.[s.id] ?? defaultStepPosition(i),
          ]),
        ),
      },
      delivery: {
        ...DEFAULT_FLOW_LAYOUT.delivery,
        ...(layoutFromMeta?.delivery ?? {}),
        ...Object.fromEntries(
          delivery.map((d, i) => [
            d.id,
            layoutFromMeta?.delivery?.[d.id] ?? {
              x: 680,
              y: 80 + i * 110,
            },
          ]),
        ),
      },
    },
  };
}

function agentField(
  agent: unknown,
  key: string,
): unknown {
  if (!agent || typeof agent !== 'object') return undefined;
  return (agent as Record<string, unknown>)[key];
}

function stringField(agent: unknown, key: string): string | undefined {
  const value = agentField(agent, key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringList(agent: unknown, key: string): string[] {
  const value = agentField(agent, key);
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeSteps(raw: unknown): FlowStepConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowStepConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? '').trim();
    const kind = String(row.kind ?? '').trim();
    if (!id) continue;
    if (kind === 'index') {
      out.push({
        id,
        kind: 'index',
        label: typeof row.label === 'string' ? row.label : undefined,
      });
      continue;
    }
    if (kind === 'review') {
      out.push({
        id,
        kind: 'review',
        label: typeof row.label === 'string' ? row.label : undefined,
        paths: Array.isArray(row.paths)
          ? row.paths.map((p) => String(p))
          : undefined,
      });
      continue;
    }
    if (kind === 'command') {
      const argv = Array.isArray(row.argv)
        ? row.argv.map((a) => String(a)).filter(Boolean)
        : typeof row.command === 'string'
          ? row.command.trim().split(/\s+/).filter(Boolean)
          : [];
      if (argv.length === 0) continue;
      out.push({
        id,
        kind: 'command',
        label: typeof row.label === 'string' ? row.label : undefined,
        argv,
        timeoutSeconds:
          typeof row.timeoutSeconds === 'number'
            ? row.timeoutSeconds
            : undefined,
        failOnError: row.failOnError !== false,
        passOutput: row.passOutput !== false,
      });
      continue;
    }
    if (kind === 'recipe') {
      out.push({
        id,
        kind: 'recipe',
        label: typeof row.label === 'string' ? row.label : undefined,
        recipeId: String(row.recipeId ?? ''),
      });
      continue;
    }
    if (kind === 'mcp') {
      out.push({
        id,
        kind: 'mcp',
        label: typeof row.label === 'string' ? row.label : undefined,
        serverId: String(row.serverId ?? ''),
        toolName:
          typeof row.toolName === 'string' ? row.toolName : undefined,
        args:
          row.args && typeof row.args === 'object' && !Array.isArray(row.args)
            ? (row.args as Record<string, unknown>)
            : undefined,
      });
      continue;
    }
    if (kind === 'hook') {
      const hookKindRaw = String(row.hookKind ?? 'post-commit');
      const hookKind =
        hookKindRaw === 'pre-push' || hookKindRaw === 'custom'
          ? hookKindRaw
          : 'post-commit';
      out.push({
        id,
        kind: 'hook',
        label: typeof row.label === 'string' ? row.label : undefined,
        hookKind,
        hookId: typeof row.hookId === 'string' ? row.hookId : undefined,
      });
      continue;
    }
    if (kind === 'skill') {
      out.push({
        id,
        kind: 'skill',
        label: typeof row.label === 'string' ? row.label : undefined,
        skillId: String(row.skillId ?? ''),
      });
    }
  }
  return out;
}

function parseMetadata(
  metadataJson: string | null | undefined,
): Record<string, unknown> {
  if (!metadataJson?.trim()) return {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Context, MCP, skills, and recipes attached on the Agent, injected into the run prompt. */
export function agentAttachmentAppendix(
  metadataJson: string | null | undefined,
): string {
  const meta = parseMetadata(metadataJson);
  const desktopFlow = (meta.desktopFlow ?? {}) as {
    agent?: Partial<FlowAgentConfig>;
    steps?: FlowStepConfig[];
  };
  const agent = desktopFlow.agent;
  const fromSteps = attachmentIdsFromSteps(desktopFlow.steps ?? []);
  const lines: string[] = [];
  const paths = agent?.contextPaths?.filter(Boolean) ?? [];
  const mcp = unique([
    ...(agent?.mcpServerIds ?? []),
    ...fromSteps.mcpServerIds,
  ]);
  const skills = unique([
    ...(agent?.skillIds ?? []),
    ...fromSteps.skillIds,
  ]);
  const recipes = unique([
    ...(agent?.recipeIds ?? []),
    ...fromSteps.recipeIds,
  ]);
  if (agent?.repository?.trim()) {
    lines.push(`- repository: ${agent.repository.trim()}`);
  }
  if (agent?.profileId?.trim()) {
    lines.push(`- profile: ${agent.profileId.trim()}`);
  }
  if (paths.length) lines.push(`- context: ${paths.join(', ')}`);
  if (mcp.length) lines.push(`- mcp: ${mcp.join(', ')}`);
  if (skills.length) lines.push(`- skills: ${skills.join(', ')}`);
  if (recipes.length) lines.push(`- recipes: ${recipes.join(', ')}`);
  if (lines.length === 0) return '';
  return `\n\n---\n## Attached\n${lines.join('\n')}\n`;
}

export function isCatalogAttachment(
  kind: string,
): kind is 'mcp' | 'skill' | 'recipe' {
  return kind === 'mcp' || kind === 'skill' || kind === 'recipe';
}

export function attachmentIdsFromSteps(steps: FlowStepConfig[]): {
  mcpServerIds: string[];
  skillIds: string[];
  recipeIds: string[];
} {
  const mcpServerIds: string[] = [];
  const skillIds: string[] = [];
  const recipeIds: string[] = [];
  for (const step of steps) {
    if (step.kind === 'mcp' && step.serverId.trim()) {
      mcpServerIds.push(step.serverId.trim());
    } else if (step.kind === 'skill' && step.skillId.trim()) {
      skillIds.push(step.skillId.trim());
    } else if (step.kind === 'recipe' && step.recipeId.trim()) {
      recipeIds.push(step.recipeId.trim());
    }
  }
  return {
    mcpServerIds: unique(mcpServerIds),
    skillIds: unique(skillIds),
    recipeIds: unique(recipeIds),
  };
}

/** Keep agent attachment lists aligned with canvas nodes. */
export function syncFlowAttachments(
  flow: AutomationFlowDocument,
): AutomationFlowDocument {
  const ids = attachmentIdsFromSteps(flow.steps);
  return {
    ...flow,
    agent: {
      ...flow.agent,
      mcpServerIds: ids.mcpServerIds,
      skillIds: ids.skillIds,
      recipeIds: ids.recipeIds,
    },
  };
}

export function defaultAttachPosition(index: number): FlowNodePosition {
  return { x: 700, y: 36 + index * 108 };
}

export function endpointKey(endpoint: FlowEndpoint): string {
  if (endpoint.kind === 'step' || endpoint.kind === 'delivery') {
    return `${endpoint.kind}:${endpoint.id}`;
  }
  return endpoint.kind;
}

export function deriveConnections(
  flow: Pick<AutomationFlowDocument, 'steps' | 'delivery'>,
): FlowConnection[] {
  const pipeline = flow.steps.filter((step) => !isCatalogAttachment(step.kind));
  const attached = flow.steps.filter((step) => isCatalogAttachment(step.kind));
  const edges: FlowConnection[] = [];
  let prev: FlowEndpoint = { kind: 'trigger' };
  for (const step of pipeline) {
    const to: FlowEndpoint = { kind: 'step', id: step.id };
    edges.push(connectionBetween(prev, to));
    prev = to;
  }
  edges.push(connectionBetween(prev, { kind: 'agent' }));
  for (const step of attached) {
    edges.push(
      connectionBetween({ kind: 'step', id: step.id }, { kind: 'agent' }),
    );
  }
  let deliveryFrom: FlowEndpoint = { kind: 'agent' };
  for (const delivery of flow.delivery) {
    const to: FlowEndpoint = { kind: 'delivery', id: delivery.id };
    edges.push(connectionBetween(deliveryFrom, to));
    deliveryFrom = to;
  }
  return edges;
}

export function materializeConnections(
  flow: AutomationFlowDocument,
): FlowConnection[] {
  return flow.connections ?? deriveConnections(flow);
}

export function connectNodes(
  flow: AutomationFlowDocument,
  from: FlowEndpoint,
  to: FlowEndpoint,
): AutomationFlowDocument {
  if (endpointKey(from) === endpointKey(to)) return flow;
  const connections = materializeConnections(flow).filter(
    (edge) =>
      !(
        endpointKey(edge.from) === endpointKey(from) &&
        endpointKey(edge.to) === endpointKey(to)
      ),
  );
  return {
    ...flow,
    connections: [...connections, connectionBetween(from, to)],
  };
}

export function disconnectNodes(
  flow: AutomationFlowDocument,
  connectionId: string,
): AutomationFlowDocument {
  return {
    ...flow,
    connections: materializeConnections(flow).filter(
      (edge) => edge.id !== connectionId,
    ),
  };
}

/** Place a main-line step on the wire that currently enters the agent. */
export function insertStepBeforeAgent(
  flow: AutomationFlowDocument,
  stepId: string,
): AutomationFlowDocument {
  const without = {
    ...flow,
    steps: flow.steps.filter((step) => step.id !== stepId),
    connections: flow.connections?.filter(
      (edge) => !endpointMentions(edge, stepId),
    ),
  };
  const connections = materializeConnections(without);
  const intoAgent = connections.find(
    (edge) =>
      edge.to.kind === 'agent' && !isAttachmentEndpoint(without, edge.from),
  );
  const from = intoAgent?.from ?? { kind: 'trigger' };
  const step: FlowEndpoint = { kind: 'step', id: stepId };
  const rest = connections.filter((edge) => edge.id !== intoAgent?.id);
  return {
    ...flow,
    connections: [
      ...rest,
      connectionBetween(from, step),
      connectionBetween(step, { kind: 'agent' }),
    ],
  };
}

/** Steps that should run: main line from the trigger, then wired attachments. */
export function runnableSteps(flow: AutomationFlowDocument): FlowStepConfig[] {
  const connections = materializeConnections(flow);
  const byId = new Map(flow.steps.map((step) => [step.id, step]));
  const ordered: FlowStepConfig[] = [];
  const seen = new Set<string>();
  let cursor = 'trigger';
  for (let guard = 0; guard < flow.steps.length + 2; guard += 1) {
    const edge = connections.find(
      (item) =>
        endpointKey(item.from) === cursor &&
        item.to.kind === 'step' &&
        !seen.has(item.to.id),
    );
    if (!edge || edge.to.kind !== 'step') break;
    const step = byId.get(edge.to.id);
    seen.add(edge.to.id);
    cursor = endpointKey(edge.to);
    if (step && !isCatalogAttachment(step.kind)) ordered.push(step);
  }
  for (const edge of connections) {
    if (edge.to.kind !== 'agent' || edge.from.kind !== 'step') continue;
    const step = byId.get(edge.from.id);
    if (!step || !isCatalogAttachment(step.kind) || seen.has(step.id)) continue;
    seen.add(step.id);
    ordered.push(step);
  }
  return ordered;
}

export function applyFlowVariables(
  template: string,
  variables: FlowVariable[] | undefined,
): string {
  let out = template;
  for (const variable of variables ?? []) {
    const key = variable.key.trim();
    if (!key) continue;
    out = out.split(`{{${key}}}`).join(variable.value);
  }
  return out;
}

function connectionBetween(from: FlowEndpoint, to: FlowEndpoint): FlowConnection {
  return {
    id: `edge_${endpointKey(from)}__${endpointKey(to)}`,
    from,
    to,
  };
}

function endpointMentions(edge: FlowConnection, stepId: string): boolean {
  return (
    (edge.from.kind === 'step' && edge.from.id === stepId) ||
    (edge.to.kind === 'step' && edge.to.id === stepId)
  );
}

function isAttachmentEndpoint(
  flow: AutomationFlowDocument,
  endpoint: FlowEndpoint,
): boolean {
  if (endpoint.kind !== 'step') return false;
  const step = flow.steps.find((item) => item.id === endpoint.id);
  return Boolean(step && isCatalogAttachment(step.kind));
}

function normalizeVariables(raw: unknown): FlowVariable[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FlowVariable[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : '';
    const value = typeof record.value === 'string' ? record.value : '';
    const id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id
        : `var_${out.length}_${key}`;
    out.push({ id, key, value });
  }
  return out;
}

function normalizeConnections(raw: unknown): FlowConnection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FlowConnection[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const from = normalizeEndpoint(record.from);
    const to = normalizeEndpoint(record.to);
    if (!from || !to) continue;
    const id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id
        : connectionBetween(from, to).id;
    out.push({ id, from, to });
  }
  return out;
}

function normalizeEndpoint(raw: unknown): FlowEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind === 'trigger' || kind === 'agent') return { kind };
  if ((kind === 'step' || kind === 'delivery') && typeof record.id === 'string') {
    return { kind, id: record.id };
  }
  return null;
}

/** Turn stored agent attachment ids into canvas nodes when a flow is opened. */
export function materializeCatalogAttachments(
  flow: AutomationFlowDocument,
  labels?: {
    mcp?: Record<string, string>;
    skill?: Record<string, string>;
    recipe?: Record<string, string>;
  },
): AutomationFlowDocument {
  const present = attachmentIdsFromSteps(flow.steps);
  const steps = [...flow.steps];
  const layoutSteps = { ...flow.layout.steps };
  const add = (
    kind: 'mcp' | 'skill' | 'recipe',
    refId: string,
    label: string,
  ) => {
    const safe = refId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const id = `step_${kind}_${safe}`;
    if (steps.some((step) => step.id === id)) return;
    const base = createFlowStep(kind);
    const labeled =
      kind === 'mcp'
        ? { ...base, id, kind: 'mcp' as const, label, serverId: refId }
        : kind === 'skill'
          ? { ...base, id, kind: 'skill' as const, label, skillId: refId }
          : { ...base, id, kind: 'recipe' as const, label, recipeId: refId };
    const attachedCount = steps.filter((step) =>
      isCatalogAttachment(step.kind),
    ).length;
    layoutSteps[labeled.id] = defaultAttachPosition(attachedCount);
    steps.push(labeled);
  };
  for (const id of flow.agent.mcpServerIds ?? []) {
    if (!present.mcpServerIds.includes(id)) {
      add('mcp', id, labels?.mcp?.[id] ?? id);
    }
  }
  for (const id of flow.agent.skillIds ?? []) {
    if (!present.skillIds.includes(id)) {
      add('skill', id, labels?.skill?.[id] ?? id);
    }
  }
  for (const id of flow.agent.recipeIds ?? []) {
    if (!present.recipeIds.includes(id)) {
      add('recipe', id, labels?.recipe?.[id] ?? id);
    }
  }
  if (steps.length === flow.steps.length) return flow;
  return syncFlowAttachments({
    ...flow,
    steps,
    layout: { ...flow.layout, steps: layoutSteps },
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function flowIdFromSourcePath(
  sourcePath: string | null | undefined,
): string | null {
  if (!sourcePath?.trim() || sourcePath.startsWith('api:')) return null;
  const base = sourcePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = base
    .replace(/\.cron\.md$/i, '')
    .replace(/\.event\.md$/i, '')
    .replace(/\.md$/i, '');
  return stem || null;
}

/** Apply {{key}} substitutions from mapping + payload. */
export function applyPromptMapping(
  template: string,
  mapping: Record<string, string> | undefined,
  payload: Record<string, unknown>,
): string {
  const values: Record<string, string> = {};
  for (const [varName, path] of Object.entries(mapping ?? {})) {
    values[varName] = String(lookupPath(payload, path) ?? '');
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    if (key in values) return values[key]!;
    const direct = lookupPath(payload, key);
    return direct == null ? `{{${key}}}` : String(direct);
  });
}

function lookupPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export const FLOW_EVENT_TYPES = [
  'github.push',
  'github.workflow_run.completed',
  'github.pull_request',
  'github.issues',
  'git.commit.local',
  'workspace.file_change',
  'manual',
] as const;

export const FLOW_DELIVERY_ADAPTERS: DeliveryAdapter[] = [
  'webhook',
  'slack',
  'discord',
  'telegram',
  'github_comment',
  'github_check',
];
