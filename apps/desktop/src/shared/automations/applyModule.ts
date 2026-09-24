/**
 * Apply a palette module drop onto an automation flow document.
 */

import {
  AUTOMATION_MODULES,
  parseDraggedModule,
  type AutomationModuleDef,
} from './modules.js';
import {
  connectNodes,
  createFlowStep,
  defaultAttachPosition,
  defaultStepPosition,
  insertStepBeforeAgent,
  syncFlowAttachments,
  type AutomationFlowDocument,
  type FlowStepConfig,
  type FlowTriggerConfig,
} from './flow.js';

export type ApplyModuleSelection =
  | { kind: 'trigger' }
  | { kind: 'agent' }
  | { kind: 'step'; id: string }
  | { kind: 'delivery'; id: string };

export function applyModuleToFlow(input: {
  flow: AutomationFlowDocument;
  moduleId: string;
  drop?: { x: number; y: number };
}): {
  flow: AutomationFlowDocument;
  selection: ApplyModuleSelection;
} | null {
  const mod =
    AUTOMATION_MODULES.find((m) => m.id === input.moduleId) ??
    parseDraggedModule(input.moduleId);
  if (!mod) return null;
  return applyModuleDefToFlow({
    flow: input.flow,
    mod,
    drop: input.drop,
  });
}

export function applyModuleDefToFlow(input: {
  flow: AutomationFlowDocument;
  mod: AutomationModuleDef;
  drop?: { x: number; y: number };
}): {
  flow: AutomationFlowDocument;
  selection: ApplyModuleSelection;
} | null {
  const { flow, mod, drop } = input;
  const apply = mod.apply;

  if (apply.type === 'trigger') {
    let trigger: FlowTriggerConfig;
    if (apply.trigger === 'schedule') {
      trigger = {
        kind: 'schedule',
        cron: '0 9 * * MON-FRI',
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      };
    } else if (apply.trigger === 'manual') {
      trigger = { kind: 'manual' };
    } else {
      trigger = {
        kind: 'event',
        eventType: apply.eventType ?? 'github.push',
        dedupeWindowSeconds: 600,
        cooldownSeconds: 120,
      };
    }
    return {
      flow: {
        ...flow,
        trigger,
        layout: {
          ...flow.layout,
          trigger: drop
            ? { x: drop.x, y: drop.y }
            : flow.layout.trigger,
        },
      },
      selection: { kind: 'trigger' },
    };
  }

  if (apply.type === 'agent') {
    return {
      flow: {
        ...flow,
        layout: {
          ...flow.layout,
          agent: drop ? { x: drop.x, y: drop.y } : flow.layout.agent,
        },
      },
      selection: { kind: 'agent' },
    };
  }

  if (apply.type === 'step') {
    const step = createFlowStep(apply.stepKind);
    const index = flow.steps.length;
    const pos = drop ?? defaultStepPosition(index);
    return {
      flow: insertStepBeforeAgent(
        {
          ...flow,
          steps: [...flow.steps, step],
          layout: {
            ...flow.layout,
            steps: {
              ...flow.layout.steps,
              [step.id]: pos,
            },
          },
        },
        step.id,
      ),
      selection: { kind: 'step', id: step.id },
    };
  }

  if (apply.type === 'attach') {
    const existing = flow.steps.find((step) =>
      stepMatchesAttach(step, apply.kind, apply.refId),
    );
    if (existing) {
      return { flow, selection: { kind: 'step', id: existing.id } };
    }
    const step = createFlowStep(apply.kind);
    const labeled = labelAttachStep(step, mod.title, apply.refId);
    const index = flow.steps.filter((s) =>
      s.kind === 'mcp' || s.kind === 'skill' || s.kind === 'recipe',
    ).length;
    const pos = drop ?? defaultAttachPosition(index);
    const withNode = {
      ...flow,
      steps: [...flow.steps, labeled],
      layout: {
        ...flow.layout,
        steps: {
          ...flow.layout.steps,
          [labeled.id]: pos,
        },
      },
    };
    return {
      flow: syncFlowAttachments(
        connectNodes(withNode, { kind: 'step', id: labeled.id }, { kind: 'agent' }),
      ),
      selection: { kind: 'step', id: labeled.id },
    };
  }

  return null;
}

function stepMatchesAttach(
  step: FlowStepConfig,
  kind: 'mcp' | 'skill' | 'recipe',
  refId: string,
): boolean {
  if (step.kind !== kind) return false;
  if (step.kind === 'mcp') return step.serverId === refId;
  if (step.kind === 'skill') return step.skillId === refId;
  return step.recipeId === refId;
}

function labelAttachStep(
  step: FlowStepConfig,
  title: string,
  refId: string,
): FlowStepConfig {
  if (step.kind === 'mcp') {
    return { ...step, label: title, serverId: refId };
  }
  if (step.kind === 'skill') {
    return { ...step, label: title, skillId: refId };
  }
  if (step.kind === 'recipe') {
    return { ...step, label: title, recipeId: refId };
  }
  return step;
}

export const MODULE_DRAG_MIME = 'application/x-mitii-module';
