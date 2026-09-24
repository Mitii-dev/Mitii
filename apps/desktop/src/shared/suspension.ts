/**
 * Suspension payloads from AgentRunResult — drive approval / clarification cards.
 */

export type SuspensionKind =
  | 'approval_required'
  | 'clarification_required'
  | 'plan_approval_required'
  | 'grant_expansion_required'
  | 'continue_required'
  | string;

export interface ClarificationOption {
  id: string;
  label: string;
  description?: string;
}

export interface DesktopSuspension {
  runId: string;
  kind: SuspensionKind;
  rationale: string;
  clarificationPrompt?: string;
  clarificationOptions?: ClarificationOption[];
  continuePrompt?: string;
  planText?: string;
  /** Structured plan when kind is plan_approval_required. */
  plan?: {
    objective: string;
    steps: Array<{ id: string; title: string; detail?: string }>;
  };
  approval?: {
    approvalId: string;
    toolName: string;
    callId: string;
    paths?: string[];
    arguments?: unknown;
  };
  grantExpansion?: {
    expansionId: string;
    extraPaths: string[];
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractSuspension(result: unknown): DesktopSuspension | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if (record.status !== 'suspended') return null;
  const runId = asString(record.runId);
  const suspension = record.suspension;
  if (!runId || !suspension || typeof suspension !== 'object') return null;
  const s = suspension as Record<string, unknown>;
  const kind = asString(s.kind);
  const rationale = asString(s.rationale);
  if (!kind || !rationale) return null;

  const approvalRaw = s.approval;
  let approval: DesktopSuspension['approval'];
  if (approvalRaw && typeof approvalRaw === 'object') {
    const a = approvalRaw as Record<string, unknown>;
    const approvalId = asString(a.approvalId);
    const toolName = asString(a.toolName);
    const callId = asString(a.callId);
    if (approvalId && toolName && callId) {
      approval = {
        approvalId,
        toolName,
        callId,
        ...(Array.isArray(a.paths)
          ? { paths: a.paths.filter((p): p is string => typeof p === 'string') }
          : {}),
        ...(a.arguments !== undefined ? { arguments: a.arguments } : {}),
      };
    }
  }

  const optionsRaw = s.clarificationOptions;
  const clarificationOptions = Array.isArray(optionsRaw)
    ? optionsRaw
        .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
        .map((o) => ({
          id: String(o.id ?? ''),
          label: String(o.label ?? ''),
          ...(typeof o.description === 'string'
            ? { description: o.description }
            : {}),
        }))
        .filter((o) => o.id && o.label)
    : undefined;

  const grantRaw = s.grantExpansion;
  let grantExpansion: DesktopSuspension['grantExpansion'];
  if (grantRaw && typeof grantRaw === 'object') {
    const g = grantRaw as Record<string, unknown>;
    const expansionId = asString(g.expansionId);
    const extraPaths = Array.isArray(g.extraPaths)
      ? g.extraPaths.filter((p): p is string => typeof p === 'string')
      : [];
    if (expansionId) {
      grantExpansion = { expansionId, extraPaths };
    }
  }

  const plan = s.plan;
  let planText: string | undefined;
  let planView: DesktopSuspension['plan'];
  if (plan && typeof plan === 'object') {
    const p = plan as Record<string, unknown>;
    const objective = asString(p.objective);
    const parts = [
      objective ? `Objective: ${objective}` : undefined,
      asString(p.scope) ? `Scope: ${p.scope}` : undefined,
      asString(p.summary) ? String(p.summary) : undefined,
    ].filter(Boolean);
    planText = parts.length > 0 ? parts.join('\n') : undefined;

    const steps: NonNullable<DesktopSuspension['plan']>['steps'] = [];
    if (Array.isArray(p.phases)) {
      for (const phaseRaw of p.phases) {
        if (!phaseRaw || typeof phaseRaw !== 'object') continue;
        const phase = phaseRaw as Record<string, unknown>;
        const phaseName =
          typeof phase.name === 'string' ? phase.name : 'Phase';
        if (!Array.isArray(phase.steps)) continue;
        for (const stepRaw of phase.steps) {
          if (!stepRaw || typeof stepRaw !== 'object') continue;
          const step = stepRaw as Record<string, unknown>;
          const intent =
            typeof step.intent === 'string' ? step.intent.trim() : '';
          if (!intent) continue;
          steps.push({
            id:
              typeof step.id === 'string' && step.id.trim()
                ? step.id
                : `step-${steps.length + 1}`,
            title: `${phaseName}: ${intent}`,
            ...(typeof step.actionSummary === 'string'
              ? { detail: step.actionSummary }
              : {}),
          });
          if (steps.length >= 24) break;
        }
        if (steps.length >= 24) break;
      }
    }
    if (objective || steps.length > 0) {
      planView = {
        objective: objective ?? 'Plan',
        steps:
          steps.length > 0
            ? steps
            : [{ id: 'objective', title: objective ?? 'Plan' }],
      };
    }
  }

  return {
    runId,
    kind,
    rationale,
    ...(asString(s.clarificationPrompt)
      ? { clarificationPrompt: asString(s.clarificationPrompt) }
      : {}),
    ...(clarificationOptions?.length ? { clarificationOptions } : {}),
    ...(asString(s.continuePrompt)
      ? { continuePrompt: asString(s.continuePrompt) }
      : {}),
    ...(planText ? { planText } : {}),
    ...(planView ? { plan: planView } : {}),
    ...(approval ? { approval } : {}),
    ...(grantExpansion ? { grantExpansion } : {}),
  };
}
