/**
 * Desktop automation executor — wraps @mitii/host executor with deterministic
 * pre-steps from metadata.desktopFlow.steps.
 */

import type {
  AutomationExecuteInput,
  AutomationExecuteResult,
  AutomationRunExecutor,
} from '@mitii/automation';
import { createAutomationRunExecutor } from '@mitii/host';
import Database from 'better-sqlite3';

import {
  parseStepsFromMetadata,
  runDeterministicSteps,
} from './steps.js';
import { patchRunLog } from './runLog.js';
import {
  AUTOMATION_FLOW_SCHEMA,
  agentAttachmentAppendix,
  applyFlowVariables,
  runnableSteps,
  type AutomationFlowDocument,
  type FlowVariable,
} from '../../shared/automations/flow.js';

export function createDesktopAutomationExecutor(options: {
  forceEcho?: boolean;
}): AutomationRunExecutor {
  const openDatabase = (
    filename: string,
    openOptions?: { readonly?: boolean; fileMustExist?: boolean },
  ) => new Database(filename, openOptions);

  const inner = createAutomationRunExecutor({
    forceEcho: options.forceEcho === true,
    openDatabase: openDatabase as never,
  });

  return {
    async execute(
      input: AutomationExecuteInput,
    ): Promise<AutomationExecuteResult> {
      const desktop = readDesktopFlow(input.metadataJson);
      const steps = desktop
        ? runnableSteps(desktop)
        : parseStepsFromMetadata(input.metadataJson);
      let stepResults: AutomationExecuteResult['stepResults'];
      const variables = desktop?.variables;
      let prompt = `${applyFlowVariables(input.prompt, variables)}${agentAttachmentAppendix(input.metadataJson)}`;
      const workspaceRoot = input.workspaceRoot;
      note(workspaceRoot, input.runId, {
        node: 'trigger',
        state: 'done',
        text: 'Trigger started',
        tone: 'ok',
      });

      if (steps.length > 0) {
        const ran = await runDeterministicSteps({
          workspaceRoot,
          steps,
          onStep: (event) => {
            note(workspaceRoot, input.runId, {
              node: event.id,
              state:
                event.phase === 'start'
                  ? 'running'
                  : event.phase === 'failed'
                    ? 'failed'
                    : 'done',
              text:
                event.phase === 'start'
                  ? `${event.kind} started`
                  : event.error || event.summary || `${event.kind} ${event.phase}`,
              tone:
                event.phase === 'failed'
                  ? 'err'
                  : event.phase === 'start'
                    ? 'info'
                    : 'ok',
            });
          },
        });
        stepResults = ran.results;
        if (ran.failed) {
          return {
            status: 'failed',
            error: friendlyRunError(ran.error ?? 'deterministic_step_failed'),
            stepResults,
            reportMarkdown: [
              `# Automation run ${input.runId}`,
              '',
              'Failed during deterministic pre-steps.',
              '',
              ran.promptAppendix,
              '',
              `Error: ${ran.error ?? 'unknown'}`,
            ].join('\n'),
          };
        }
        if (ran.promptAppendix.trim()) {
          prompt = `${prompt}

---
## Command output
${ran.promptAppendix}
`;
        }
      }

      note(workspaceRoot, input.runId, {
        node: 'agent',
        state: 'running',
        text: 'Agent running',
        tone: 'info',
      });
      const result = await inner.execute({
        ...input,
        prompt,
      });
      const error = friendlyRunError(result.error);
      note(workspaceRoot, input.runId, {
        node: 'agent',
        state: result.status === 'done' ? 'done' : 'failed',
        text:
          result.status === 'done'
            ? 'Agent finished'
            : error || 'Agent failed',
        tone: result.status === 'done' ? 'ok' : 'err',
      });
      return {
        ...result,
        error,
        stepResults: stepResults ?? result.stepResults,
      };
    },
  };
}

function note(
  workspaceRoot: string,
  runId: string,
  input: {
    node: string;
    state: 'queued' | 'running' | 'done' | 'failed';
    text: string;
    tone: 'info' | 'ok' | 'err';
  },
): void {
  try {
    patchRunLog(workspaceRoot, runId, (current) => ({
      ...current,
      nodes: { ...current.nodes, [input.node]: input.state },
      lines: [
        ...current.lines,
        {
          at: new Date().toISOString(),
          text: input.text,
          tone: input.tone,
        },
      ],
    }));
  } catch {
    // Live log is best-effort.
  }
}

function readDesktopFlow(
  metadataJson: string | null | undefined,
): AutomationFlowDocument | null {
  if (!metadataJson?.trim()) return null;
  try {
    const meta = JSON.parse(metadataJson) as {
      desktopFlow?: Partial<AutomationFlowDocument>;
    };
    const flow = meta.desktopFlow;
    if (!flow || !Array.isArray(flow.steps)) return null;
    return {
      schemaVersion: 1,
      schema: AUTOMATION_FLOW_SCHEMA,
      id: 'run',
      title: '',
      enabled: true,
      trigger: { kind: 'manual' },
      steps: flow.steps,
      agent: {
        mode: 'agent',
        autonomyPreset: 'apply',
        prompt: '',
        ...(flow.agent ?? {}),
      },
      delivery: [],
      variables: flow.variables as FlowVariable[] | undefined,
      connections: flow.connections,
      layout: {
        trigger: { x: 0, y: 0 },
        agent: { x: 0, y: 0 },
        steps: {},
        delivery: {},
      },
    };
  } catch {
    return null;
  }
}

function friendlyRunError(message: string | undefined): string | undefined {
  if (!message) return message;
  if (
    /aborted due to timeout|timed out after|llm request timed out|operation was aborted/i.test(
      message,
    )
  ) {
    return 'The model request timed out before it finished. Trigger again, or choose a faster model.';
  }
  return message;
}
