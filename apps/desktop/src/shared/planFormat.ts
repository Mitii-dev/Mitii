/**
 * Format structured PlanArtifact (or plain serializePlanText) as markdown
 * for chat display.
 *
 * Browser-safe: no runtime import from @mitii/sdk / @mitii/v8 (those pull
 * Node builtins into the Vite renderer bundle). Shapes mirror the engine.
 */

export const PLANNING_SCHEMA_VERSION = 1 as const;

export interface PlanStep {
  id: string;
  intent: string;
  targetRefs: string[];
  actionSummary: string;
  expectedOutcome: string;
  verification?: string;
  riskLevel: string;
  mustRead?: string[];
  affected?: string[];
}

export interface PlanPhase {
  id: string;
  name: string;
  purpose: string;
  dependencies: string[];
  successCriteria: string[];
  steps: PlanStep[];
}

export interface PlanArtifact {
  schemaVersion: typeof PLANNING_SCHEMA_VERSION;
  objective: string;
  assumptions: string[];
  openQuestions: string[];
  contextReviewed: unknown[];
  constraints: string[];
  dimensions: {
    scope: string;
    risk: string;
    clarity: string;
    complexity: string;
    changeImpact: string[];
  };
  phases: PlanPhase[];
  risks: Array<{
    severity: string;
    summary: string;
    mitigation?: string;
  }>;
  alternatives: Array<{ summary: string; tradeoff?: string }>;
  verification: {
    checks: string[];
    manualQa: string[];
    commands: string[];
  };
  rollback?: string;
  approvalRequired: boolean;
  processHintsApplied: string[];
}

export interface PlanStrategyDecision {
  schemaVersion: 1;
  strategy: string;
  rationale: string;
  confidence?: number;
  skipDiscover: boolean;
  useBuildEvidence: boolean;
}

export interface TaskList {
  schemaVersion: 1;
  source: string;
  purpose?: string;
  title?: string;
  items: Array<{
    id: string;
    title: string;
    status: string;
    detail?: string;
    sourceRef?: string;
    write?: string[];
    mustRead?: string[];
    affected?: string[];
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function parsePlanArtifact(value: unknown): PlanArtifact | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.objective !== 'string' || !value.objective.trim()) {
    return undefined;
  }
  if (!Array.isArray(value.phases) || value.phases.length === 0) {
    return undefined;
  }
  const dimensions = isRecord(value.dimensions) ? value.dimensions : {};
  const verification = isRecord(value.verification) ? value.verification : {};
  const phases: PlanPhase[] = [];
  for (const phaseRaw of value.phases) {
    if (!isRecord(phaseRaw)) continue;
    if (typeof phaseRaw.name !== 'string' || typeof phaseRaw.purpose !== 'string') {
      continue;
    }
    const steps: PlanStep[] = [];
    for (const stepRaw of Array.isArray(phaseRaw.steps) ? phaseRaw.steps : []) {
      if (!isRecord(stepRaw)) continue;
      if (
        typeof stepRaw.intent !== 'string' ||
        typeof stepRaw.actionSummary !== 'string'
      ) {
        continue;
      }
      steps.push({
        id: typeof stepRaw.id === 'string' ? stepRaw.id : `step-${steps.length + 1}`,
        intent: stepRaw.intent,
        targetRefs: asStringArray(stepRaw.targetRefs),
        actionSummary: stepRaw.actionSummary,
        expectedOutcome:
          typeof stepRaw.expectedOutcome === 'string'
            ? stepRaw.expectedOutcome
            : '',
        ...(typeof stepRaw.verification === 'string'
          ? { verification: stepRaw.verification }
          : {}),
        riskLevel:
          typeof stepRaw.riskLevel === 'string' ? stepRaw.riskLevel : 'low',
        ...(Array.isArray(stepRaw.mustRead)
          ? { mustRead: asStringArray(stepRaw.mustRead) }
          : {}),
        ...(Array.isArray(stepRaw.affected)
          ? { affected: asStringArray(stepRaw.affected) }
          : {}),
      });
    }
    phases.push({
      id: typeof phaseRaw.id === 'string' ? phaseRaw.id : `phase-${phases.length + 1}`,
      name: phaseRaw.name,
      purpose: phaseRaw.purpose,
      dependencies: asStringArray(phaseRaw.dependencies),
      successCriteria: asStringArray(phaseRaw.successCriteria),
      steps,
    });
  }
  if (phases.length === 0) return undefined;

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: value.objective,
    assumptions: asStringArray(value.assumptions),
    openQuestions: asStringArray(value.openQuestions),
    contextReviewed: Array.isArray(value.contextReviewed)
      ? value.contextReviewed
      : [],
    constraints: asStringArray(value.constraints),
    dimensions: {
      scope: typeof dimensions.scope === 'string' ? dimensions.scope : 'unknown',
      risk: typeof dimensions.risk === 'string' ? dimensions.risk : 'unknown',
      clarity:
        typeof dimensions.clarity === 'string' ? dimensions.clarity : 'unknown',
      complexity:
        typeof dimensions.complexity === 'string'
          ? dimensions.complexity
          : 'unknown',
      changeImpact: asStringArray(dimensions.changeImpact),
    },
    phases,
    risks: Array.isArray(value.risks)
      ? value.risks.flatMap((risk) => {
          if (!isRecord(risk) || typeof risk.summary !== 'string') return [];
          return [
            {
              severity:
                typeof risk.severity === 'string' ? risk.severity : 'info',
              summary: risk.summary,
              ...(typeof risk.mitigation === 'string'
                ? { mitigation: risk.mitigation }
                : {}),
            },
          ];
        })
      : [],
    alternatives: Array.isArray(value.alternatives)
      ? value.alternatives.flatMap((alt) => {
          if (!isRecord(alt) || typeof alt.summary !== 'string') return [];
          return [
            {
              summary: alt.summary,
              ...(typeof alt.tradeoff === 'string'
                ? { tradeoff: alt.tradeoff }
                : {}),
            },
          ];
        })
      : [],
    verification: {
      checks: asStringArray(verification.checks),
      manualQa: asStringArray(verification.manualQa),
      commands: asStringArray(verification.commands),
    },
    ...(typeof value.rollback === 'string' ? { rollback: value.rollback } : {}),
    approvalRequired: value.approvalRequired === true,
    processHintsApplied: asStringArray(value.processHintsApplied),
  };
}

export function parsePlanStrategy(
  value: unknown,
): PlanStrategyDecision | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.strategy !== 'string' || typeof value.rationale !== 'string') {
    return undefined;
  }
  return {
    schemaVersion: 1,
    strategy: value.strategy,
    rationale: value.rationale,
    ...(typeof value.confidence === 'number'
      ? { confidence: value.confidence }
      : {}),
    skipDiscover: value.skipDiscover === true,
    useBuildEvidence: value.useBuildEvidence === true,
  };
}

export function parseTaskList(value: unknown): TaskList | undefined {
  if (!isRecord(value)) return undefined;
  if (!Array.isArray(value.items)) return undefined;
  const items: TaskList['items'] = [];
  for (const item of value.items) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== 'string' || typeof item.title !== 'string') continue;
    items.push({
      id: item.id,
      title: item.title,
      status: typeof item.status === 'string' ? item.status : 'pending',
      ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
      ...(typeof item.sourceRef === 'string'
        ? { sourceRef: item.sourceRef }
        : {}),
      ...(Array.isArray(item.write) ? { write: asStringArray(item.write) } : {}),
      ...(Array.isArray(item.mustRead)
        ? { mustRead: asStringArray(item.mustRead) }
        : {}),
      ...(Array.isArray(item.affected)
        ? { affected: asStringArray(item.affected) }
        : {}),
    });
  }
  return {
    schemaVersion: 1,
    source: typeof value.source === 'string' ? value.source : 'agent',
    ...(typeof value.purpose === 'string' ? { purpose: value.purpose } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    items,
  };
}

/** Pull plan fields from an AgentRunResult-shaped object. */
export function extractPlanFromRunResult(result: unknown): {
  plan?: PlanArtifact;
  planStrategy?: PlanStrategyDecision;
  taskList?: TaskList;
} {
  if (!isRecord(result)) return {};
  const fromTop = parsePlanArtifact(result.plan);
  const suspension = isRecord(result.suspension) ? result.suspension : null;
  const fromSuspension = suspension
    ? parsePlanArtifact(suspension.plan)
    : undefined;
  const plan = fromTop ?? fromSuspension;
  const planStrategy = parsePlanStrategy(result.planStrategy);
  const taskList = parseTaskList(result.taskList);
  return {
    ...(plan ? { plan } : {}),
    ...(planStrategy ? { planStrategy } : {}),
    ...(taskList ? { taskList } : {}),
  };
}

/**
 * When the model returns plan markdown but no structured PlanArtifact,
 * build a minimal artifact so the desktop can show the follow strip and
 * offer “Execute in Agent” (VS Code planFromAnswer parity).
 */
export function synthesizePlanArtifactFromAnswer(
  answer: string,
): PlanArtifact | undefined {
  const trimmed = answer.trim();
  if (!trimmed) return undefined;

  const looksLikePlan =
    /^#\s+/m.test(trimmed) ||
    /^Objective:\s*/im.test(trimmed) ||
    /^##\s+Plan\b/im.test(trimmed) ||
    /^Plan:\s*$/im.test(trimmed) ||
    /^\d+\.\s+\S/m.test(trimmed);
  if (!looksLikePlan) return undefined;

  const objectiveMatch =
    trimmed.match(/^#\s+(.+)$/m) ||
    trimmed.match(/^Objective:\s*(.+)$/im);
  const objective = (objectiveMatch?.[1] ?? 'Implementation plan')
    .trim()
    .slice(0, 200);

  const stepLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line) || /^\d+([.)]|\.\d+\.)\s+\S/.test(line))
    .slice(0, 16);

  const steps: PlanStep[] =
    stepLines.length > 0
      ? stepLines.map((line, index) => {
          const title = line
            .replace(/^[-*]\s+/, '')
            .replace(/^\d+([.)]|\.\d+\.)\s+/, '')
            .slice(0, 200);
          return {
            id: `step-${index + 1}`,
            intent: title || `Step ${index + 1}`,
            targetRefs: [],
            actionSummary: title || `Step ${index + 1}`,
            expectedOutcome: '',
            riskLevel: 'low',
          };
        })
      : [
          {
            id: 'step-1',
            intent: 'See assistant reply for plan details',
            targetRefs: [],
            actionSummary: 'Follow the plan in the chat reply.',
            expectedOutcome: '',
            riskLevel: 'low',
          },
        ];

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    assumptions: [],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: 'unknown',
      risk: 'unknown',
      clarity: 'unknown',
      complexity: 'unknown',
      changeImpact: [],
    },
    phases: [
      {
        id: 'phase-1',
        name: 'Plan',
        purpose: 'Steps derived from the plan reply.',
        dependencies: [],
        successCriteria: [],
        steps,
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: [], manualQa: [], commands: [] },
    approvalRequired: true,
    processHintsApplied: ['desktop_synthesize_from_answer'],
  };
}

/**
 * Render a PlanArtifact as markdown suitable for MarkdownBody.
 */
export function formatPlanAsMarkdown(plan: PlanArtifact): string {
  const lines: string[] = [`# ${plan.objective}`, ''];

  lines.push(
    `**Scope:** ${plan.dimensions.scope} · **Risk:** ${plan.dimensions.risk} · **Clarity:** ${plan.dimensions.clarity} · **Complexity:** ${plan.dimensions.complexity}`,
  );
  if (plan.dimensions.changeImpact.length > 0) {
    lines.push(
      `**Change impact:** ${plan.dimensions.changeImpact.join(', ')}`,
    );
  }
  lines.push('');

  if (plan.assumptions.length > 0) {
    lines.push('## Assumptions', '');
    for (const item of plan.assumptions) lines.push(`- ${item}`);
    lines.push('');
  }
  if (plan.openQuestions.length > 0) {
    lines.push('## Open questions', '');
    for (const item of plan.openQuestions) lines.push(`- ${item}`);
    lines.push('');
  }
  if (plan.constraints.length > 0) {
    lines.push('## Constraints', '');
    for (const item of plan.constraints) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push('## Plan', '');
  for (const [phaseIndex, phase] of plan.phases.entries()) {
    lines.push(`### ${phaseIndex + 1}. ${phase.name}`, '');
    lines.push(phase.purpose, '');
    if (phase.successCriteria.length > 0) {
      lines.push('**Acceptance**', '');
      for (const criterion of phase.successCriteria.slice(0, 4)) {
        lines.push(`- ${criterion}`);
      }
      lines.push('');
    }
    for (const [stepIndex, step] of phase.steps.entries()) {
      lines.push(
        `#### ${phaseIndex + 1}.${stepIndex + 1}. ${step.intent}`,
        '',
      );
      lines.push(step.actionSummary, '');
      if (step.targetRefs.length > 0) {
        lines.push(
          `- **Write:** ${step.targetRefs
            .slice(0, 8)
            .map((ref: string) => `\`${ref}\``)
            .join(', ')}`,
        );
      }
      if (step.mustRead && step.mustRead.length > 0) {
        lines.push(
          `- **Need:** ${step.mustRead
            .map((ref: string) => `\`${ref}\``)
            .join(', ')}`,
        );
      }
      if (step.affected && step.affected.length > 0) {
        lines.push(
          `- **Affected:** ${step.affected
            .map((ref: string) => `\`${ref}\``)
            .join(', ')}`,
        );
      }
      if (step.expectedOutcome) {
        lines.push(`- **Done when:** ${step.expectedOutcome}`);
      }
      lines.push('');
    }
  }

  if (plan.alternatives.length > 0) {
    lines.push('## Alternatives / tradeoffs', '');
    for (const alternative of plan.alternatives) {
      lines.push(`- ${alternative.summary}`);
      if (alternative.tradeoff) {
        lines.push(`  - *But:* ${alternative.tradeoff}`);
      }
    }
    lines.push('');
  }

  if (plan.risks.length > 0) {
    lines.push('## Risks', '');
    for (const risk of plan.risks) {
      const mitigation = risk.mitigation ? ` — *If so:* ${risk.mitigation}` : '';
      lines.push(`- **[${risk.severity}]** ${risk.summary}${mitigation}`);
    }
    lines.push('');
  }

  const verification = [
    ...plan.verification.checks,
    ...plan.verification.commands,
    ...plan.verification.manualQa,
  ].filter((part) => part.trim().length > 0);
  if (verification.length > 0) {
    lines.push('## Verification', '');
    for (const item of verification) lines.push(`- ${item}`);
    lines.push('');
  }

  if (plan.rollback) {
    lines.push('## Rollback', '', plan.rollback, '');
  }
  if (plan.approvalRequired) {
    lines.push('> Approval required before mutation.', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Prefer structured plan markdown; otherwise lightly promote plain plan text
 * (Objective:/Plan: labels) so MarkdownBody renders headings.
 */
export function resolvePlanDisplayText(options: {
  answer: string;
  plan?: PlanArtifact;
}): string {
  if (options.plan) return formatPlanAsMarkdown(options.plan);
  return promotePlainPlanText(options.answer);
}

/** Heuristic: turn serializePlanText labels into markdown headings. */
export function promotePlainPlanText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (/^#\s/m.test(trimmed)) return text;

  const lines = trimmed.split('\n');
  const out: string[] = [];
  let sawPlan = false;

  for (const line of lines) {
    if (/^Objective:\s*/i.test(line)) {
      out.push(`# ${line.replace(/^Objective:\s*/i, '').trim()}`, '');
      continue;
    }
    if (/^Scope:\s*/i.test(line)) {
      out.push(`**${line.trim()}**`, '');
      continue;
    }
    if (/^Change impact:\s*/i.test(line)) {
      out.push(`**${line.trim()}**`, '');
      continue;
    }
    if (/^Assumptions:\s*$/i.test(line)) {
      out.push('## Assumptions', '');
      continue;
    }
    if (/^Open questions:\s*$/i.test(line)) {
      out.push('## Open questions', '');
      continue;
    }
    if (/^Constraints:\s*$/i.test(line)) {
      out.push('## Constraints', '');
      continue;
    }
    if (/^Plan:\s*$/i.test(line)) {
      out.push('## Plan', '');
      sawPlan = true;
      continue;
    }
    if (/^Alternatives \/ tradeoffs:\s*$/i.test(line)) {
      out.push('## Alternatives / tradeoffs', '');
      continue;
    }
    if (/^Risks \/ ifs:\s*$/i.test(line)) {
      out.push('## Risks', '');
      continue;
    }
    if (/^Verification:\s*/i.test(line)) {
      out.push('## Verification', '', line.replace(/^Verification:\s*/i, ''));
      continue;
    }
    if (/^Rollback:\s*/i.test(line)) {
      out.push('## Rollback', '', line.replace(/^Rollback:\s*/i, ''));
      continue;
    }
    if (sawPlan && /^\d+\.\s+\S/.test(line)) {
      out.push(`### ${line.trim()}`, '');
      continue;
    }
    if (sawPlan && /^\s+\d+\.\d+\.\s+/.test(line)) {
      out.push(`#### ${line.trim()}`, '');
      continue;
    }
    out.push(line);
  }

  return out.join('\n').trimEnd() + '\n';
}

export function resolvePlanHandoff(options: {
  mode: 'ask' | 'plan' | 'agent';
  pendingPlan: unknown;
}): PlanArtifact | undefined {
  if (options.mode !== 'agent') return undefined;
  return parsePlanArtifact(options.pendingPlan);
}

export function resolvePlanStrategyHandoff(options: {
  mode: 'ask' | 'plan' | 'agent';
  pendingPlanStrategy: unknown;
}): PlanStrategyDecision | undefined {
  if (options.mode !== 'agent') return undefined;
  return parsePlanStrategy(options.pendingPlanStrategy);
}
