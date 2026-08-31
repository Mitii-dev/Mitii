import {
  AGENT_ENGINE_SCHEMA_VERSION,
  InMemoryRepositoryStateStore,
  NodeGitAdapter,
  NodeNetworkAdapter,
  NodeProcessAdapter,
  NodeWorkspaceFileSystemAdapter,
  RepositoryStatePipeline,
  ToolRuntimePipeline,
  VerificationPipeline,
  WorkspaceFileSystemManifestReader,
  createMitiiClient,
  type MitiiClient,
  type MitiiResumeInput,
} from '@mitii/sdk';
import type {
  AutomationExecuteInput,
  AutomationExecuteResult,
  AutomationRunExecutor,
} from '@mitii/automation';

import { createHostLlmPorts } from '../config/createHostLlmPorts.js';
import {
  inferHostProviderType,
  resolveProviderApiKey,
} from '../config/resolveProviderApiKey.js';
import {
  getProviderPreset,
  isHostProviderType,
} from '../config/providerPresets.js';
import { createHostCodeNavigationPort } from '../code-navigation/createHostCodeNavigationPort.js';
import { createHostRepositoryGraphPort } from '../repository-graph/loadWorkspaceGraphs.js';
import { createOptionalSearchPort } from '../ports/search.js';
import { createFileSystemSkillsCatalog } from '../ports/skillsCatalog.js';
import { createWorkspaceCheckpointStore } from '../ports/checkpoints.js';
import { createWorkspaceVerificationStore } from '../ports/verificationRecords.js';

export interface CreateAutomationRunExecutorOptions {
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * SDK-backed executor for @mitii/automation ClaimRunner.
 * Keeps automation package free of SDK imports (architecture boundary).
 */
export function createAutomationRunExecutor(
  options: CreateAutomationRunExecutorOptions = {},
): AutomationRunExecutor {
  const env = options.env ?? process.env;
  return {
    async execute(input: AutomationExecuteInput): Promise<AutomationExecuteResult> {
      const client = createAutomationClient({
        cwd: input.workspaceRoot,
        forceEcho: options.forceEcho,
        env,
      });

      const approvalMode =
        input.autonomyPreset === 'readonly' ? undefined : ('never' as const);
      const planApproval =
        input.autonomyPreset === 'readonly' ? undefined : ('never' as const);

      let run = client.start({
        prompt: input.prompt,
        mode: input.mode,
        origin: 'automation',
        autonomyPreset: input.autonomyPreset,
        workspaceRoot: input.workspaceRoot,
        ...(approvalMode ? { approvalMode } : {}),
        ...(planApproval ? { planApproval } : {}),
      });

      const deadline = input.timeoutSeconds
        ? Date.now() + input.timeoutSeconds * 1000
        : undefined;

      for (;;) {
        if (deadline && Date.now() > deadline) {
          run.cancel('timeout');
          const result = await run.result;
          return {
            status: 'cancelled',
            error: `Timed out after ${input.timeoutSeconds}s`,
            sessionId: result.runId,
            answer: result.answer,
          };
        }

        // Drain events
        for await (const _event of run.events) {
          if (deadline && Date.now() > deadline) {
            run.cancel('timeout');
            break;
          }
        }

        const result = await run.result;
        if (result.status === 'completed') {
          return {
            status: 'done',
            answer: result.answer,
            sessionId: result.runId,
          };
        }
        if (result.status === 'cancelled') {
          return {
            status: 'cancelled',
            error: result.error?.message ?? 'cancelled',
            sessionId: result.runId,
            answer: result.answer,
          };
        }
        if (result.status === 'failed') {
          return {
            status: 'failed',
            error: result.error?.message ?? 'failed',
            sessionId: result.runId,
            answer: result.answer,
          };
        }
        if (result.status === 'suspended') {
          const kind = result.suspension?.kind;
          if (
            kind === 'approval_required' ||
            kind === 'plan_approval_required'
          ) {
            const resume = buildAutoApproveResume(result);
            if (!resume) {
              return {
                status: 'failed',
                error: `Suspended (${kind}) without resume payload`,
                sessionId: result.runId,
              };
            }
            run = client.resume(resume);
            continue;
          }
          return {
            status: 'failed',
            error: `Suspended needing clarification (${kind ?? 'unknown'})`,
            sessionId: result.runId,
            answer: result.answer,
          };
        }
        return {
          status: 'failed',
          error: `Unexpected status: ${result.status}`,
          sessionId: result.runId,
        };
      }
    },
  };
}

function buildAutoApproveResume(result: {
  runId: string;
  suspension?: {
    kind: string;
    approval?: { approvalId: string };
  };
}): MitiiResumeInput | undefined {
  const suspension = result.suspension;
  if (!suspension) return undefined;
  if (
    suspension.kind === 'approval_required' &&
    suspension.approval?.approvalId
  ) {
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      approval: {
        approvalId: suspension.approval.approvalId,
        decision: 'approved',
      },
      approvalMode: 'never',
    };
  }
  if (suspension.kind === 'plan_approval_required') {
    return {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: result.runId,
      planDecision: { decision: 'approved' },
      approvalMode: 'never',
    };
  }
  return undefined;
}

function createAutomationClient(options: {
  cwd: string;
  forceEcho?: boolean;
  env: NodeJS.ProcessEnv;
}): MitiiClient {
  const env = options.env;
  const type =
    (env.MITII_PROVIDER && isHostProviderType(env.MITII_PROVIDER)
      ? env.MITII_PROVIDER
      : undefined) ??
    inferHostProviderType(env) ??
    'echo';
  const forceEcho = options.forceEcho === true || type === 'echo';
  const preset = getProviderPreset(type);
  const model = env.MITII_MODEL ?? preset?.model ?? 'gpt-4o-mini';
  const baseUrl = env.MITII_BASE_URL ?? preset?.baseUrl;
  const apiKey = resolveProviderApiKey({ type, env });
  const ports = createHostLlmPorts(
    forceEcho
      ? { type: 'echo', model: 'echo' }
      : {
          type,
          model,
          ...(baseUrl ? { baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
        },
  );

  const fileSystem = new NodeWorkspaceFileSystemAdapter();
  const search = createOptionalSearchPort(env);
  const git = new NodeGitAdapter();
  const tools = new ToolRuntimePipeline({
    fileSystem,
    process: new NodeProcessAdapter(),
    network: new NodeNetworkAdapter(),
    git,
    codeNavigation: createHostCodeNavigationPort({
      workspaceRoot: options.cwd,
    }),
    repoGraphs: createHostRepositoryGraphPort({
      workspaceRoot: options.cwd,
    }),
    ...(search ? { search } : {}),
  });
  const verification = new VerificationPipeline({
    tools,
    manifests: new WorkspaceFileSystemManifestReader({
      fileSystem,
      workspaceRoot: options.cwd,
    }),
    records: createWorkspaceVerificationStore(options.cwd),
  });
  const repositoryState = new RepositoryStatePipeline({
    store: new InMemoryRepositoryStateStore(),
  });

  return createMitiiClient({
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    workspaceRoot: options.cwd,
    defaultMode: 'agent',
    defaultSessionId: 'automation_session',
    workspaceId: 'automation_workspace',
    repositoryState,
    enableInMemoryCheckpoints: false,
    checkpointStore: createWorkspaceCheckpointStore(options.cwd),
    tools,
    verification,
    skillsCatalog: createFileSystemSkillsCatalog({
      workspaceRoot: options.cwd,
      includeBundled: true,
    }),
  });
}
