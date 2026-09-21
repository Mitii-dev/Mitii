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
  if (plan && typeof plan === 'object') {
    const p = plan as Record<string, unknown>;
    const parts = [
      asString(p.objective) ? `Objective: ${p.objective}` : undefined,
      asString(p.scope) ? `Scope: ${p.scope}` : undefined,
      asString(p.summary) ? String(p.summary) : undefined,
    ].filter(Boolean);
    planText = parts.length > 0 ? parts.join('\n') : undefined;
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
    ...(approval ? { approval } : {}),
    ...(grantExpansion ? { grantExpansion } : {}),
  };
}
