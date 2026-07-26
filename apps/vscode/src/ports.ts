import {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
  createDefaultSkillsCatalog,
  createMitiiClient,
  type LlmPort,
  type MitiiClient,
  type SkillsCatalogPort,
} from '@mitii/sdk';
import type { ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';
import type * as vscode from 'vscode';

export class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'vscode-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'vscode/local-understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.9,
        alternatives: [],
        needsClarification: false,
        reason: 'VS Code local understanding (no remote provider).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export interface VscodePortResolution {
  understandingLlm: LlmPort;
  runLlm: LlmPort;
  providerLabel: string;
  workspaceId: string;
}

/**
 * Compose LLM ports from mitii.* settings + SecretStorage / env.
 * Secrets never come from settings JSON defaults.
 */
export async function resolveVscodePorts(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
): Promise<VscodePortResolution> {
  const cfg = vs.workspace.getConfiguration('mitii');
  const providerType = cfg.get<string>('provider.type') ?? 'echo';
  const model = cfg.get<string>('provider.model') ?? 'gpt-4o-mini';
  const baseUrl = cfg.get<string>('provider.baseUrl') ?? undefined;
  const workspaceId = 'vscode_workspace';

  const forceEcho = providerType === 'echo';
  const secretKey =
    (await secrets.get('mitii.provider.apiKey')) ??
    process.env.MITII_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!forceEcho && secretKey) {
    const runLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey: secretKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
    const understandingLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey: secretKey,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: { supportsStructuredOutput: true },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `openai-compatible:${model}`,
      workspaceId,
    };
  }

  return {
    understandingLlm: new LocalUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    providerLabel: forceEcho || !secretKey ? 'echo' : 'echo',
    workspaceId,
  };
}

export async function createVscodeClient(
  vs: typeof vscode,
  secrets: vscode.SecretStorage,
  workspaceRoot: string | undefined,
  options: { skillsCatalog?: SkillsCatalogPort } = {},
): Promise<{ client: MitiiClient; ports: VscodePortResolution }> {
  const ports = await resolveVscodePorts(vs, secrets);
  const client = createMitiiClient({
    understandingLlm: ports.understandingLlm,
    runLlm: ports.runLlm,
    workspaceRoot,
    defaultMode: 'ask',
    defaultSessionId: 'vscode_session',
    workspaceId: ports.workspaceId,
    enableInMemoryRepositoryState: true,
    enableInMemoryCheckpoints: true,
    skillsCatalog: options.skillsCatalog ?? createDefaultSkillsCatalog(),
  });
  return { client, ports };
}
