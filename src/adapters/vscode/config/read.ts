import * as vscode from 'vscode';
import {
  ThunderConfigSchema,
  type ThunderConfig,
} from '../../../kernel/config/schema';
import { defaultThunderConfig } from '../../../kernel/config/defaults';
import { CONFIG_SECTION, LEGACY_CONFIG_SECTION } from '../../../kernel/config/keys';

export function readThunderConfigFromSettings(): ThunderConfig {
  const config = createMitiiConfigReader();
  const raw = {
    debug: config.get<boolean>('debug'),
    debugTrace: {
      enabled: config.get<boolean>('debugOptions.trace.enabled'),
      includePayloads: config.get<boolean>('debugOptions.trace.includePayloads'),
      llm: config.get<boolean>('debugOptions.trace.llm'),
      mcp: config.get<boolean>('debugOptions.trace.mcp'),
      webview: config.get<boolean>('debugOptions.trace.webview'),
      daemon: config.get<boolean>('debugOptions.trace.daemon'),
      webhook: config.get<boolean>('debugOptions.trace.webhook'),
      maxPayloadChars: config.get<number>('debugOptions.trace.maxPayloadChars'),
    },
    provider: {
      type: config.get<string>('provider.type'),
      baseUrl: config.get<string>('provider.baseUrl'),
      model: config.get<string>('provider.model'),
      apiVersion: config.get<string>('provider.apiVersion'),
      region: config.get<string>('provider.region'),
      apiKeyRef: config.get<string>('provider.apiKeyRef'),
      contextWindow: config.get<number>('provider.contextWindow'),
      supportsStreaming: config.get<boolean>('provider.supportsStreaming'),
      supportsTools: config.get<boolean>('provider.supportsTools'),
      supportsEmbeddings: config.get<boolean>('provider.supportsEmbeddings'),
      supportsVision: config.get<boolean>('provider.supportsVision'),
      supportsReasoning: config.get<boolean>('provider.supportsReasoning'),
    },
    indexing: {
      enabled: config.get<boolean>('indexing.enabled'),
      autoIndexOnOpen: config.get<boolean>('indexing.autoIndexOnOpen'),
      maxFileSizeBytes: config.get<number>('indexing.maxFileSizeBytes'),
      hardSkipSizeBytes: config.get<number>('indexing.hardSkipSizeBytes'),
      respectGitignore: config.get<boolean>('indexing.respectGitignore'),
      respectThunderignore: config.get<boolean>('indexing.respectThunderignore'),
      maxConcurrency: config.get<number>('indexing.maxConcurrency'),
      treeSitterEnabled: config.get<boolean>('indexing.treeSitterEnabled'),
      vectorsEnabled: config.get<boolean>('indexing.vectorsEnabled'),
      embeddingProvider: config.get<string>('indexing.embeddingProvider'),
      vectorBackend: config.get<string>('indexing.vectorBackend'),
      watchDebounceMs: config.get<number>('indexing.watchDebounceMs'),
      priorityPaths: config.get<string[]>('indexing.priorityPaths'),
    },
    context: {
      rerankerEnabled: config.get<boolean>('context.rerankerEnabled'),
      rerankerCandidatePool: config.get<number>('context.rerankerCandidatePool'),
      rerankerTopK: config.get<number>('context.rerankerTopK'),
      microTaskRoutingEnabled: config.get<boolean>('context.microTaskRoutingEnabled'),
    },
    safety: {
      requireApprovalForWrites: config.get<boolean>('safety.requireApprovalForWrites'),
      requireApprovalForShell: config.get<boolean>('safety.requireApprovalForShell'),
      allowNetwork: config.get<boolean>('safety.allowNetwork'),
      blockDangerousCommands: config.get<boolean>('safety.blockDangerousCommands'),
      approvalMode: config.get<string>('safety.approvalMode'),
      autonomyPreset: config.get<string>('safety.autonomyPreset'),
      allowUntrustedWorkspace: config.get<boolean>('safety.allowUntrustedWorkspace'),
    },
    memory: {
      enabled: config.get<boolean>('memory.enabled'),
      maxItems: config.get<number>('memory.maxItems'),
      summarizeAfterTask: config.get<boolean>('memory.summarizeAfterTask'),
      hybridSearchEnabled: config.get<boolean>('memory.hybridSearchEnabled'),
      autoMemoryEnabled: config.get<boolean>('memory.autoMemoryEnabled'),
      autoMemoryScope: config.get<string>('memory.autoMemoryScope'),
    },
    agent: {
      agenticTierOverride: config.get<string>('agent.agenticTierOverride'),
      subagentsEnabled: config.get<boolean>('agent.subagentsEnabled'),
      teamsEnabled: config.get<boolean>('agent.teamsEnabled'),
      maxSteps: config.get<number>('agent.maxSteps'),
      askMaxSteps: config.get<number>('agent.askMaxSteps'),
      askDepth: config.get<string>('agent.askDepth'),
      planDepth: config.get<string>('agent.planDepth'),
      actDepth: config.get<string>('agent.actDepth'),
      askAutoContinue: config.get<boolean>('agent.askAutoContinue'),
      askMaxAutoContinues: config.get<number>('agent.askMaxAutoContinues'),
      autoContinue: config.get<boolean>('agent.autoContinue'),
      maxAutoContinues: config.get<number>('agent.maxAutoContinues'),
      researchAgentMaxSteps: config.get<number>('agent.researchAgentMaxSteps'),
      researchAgentTimeoutMs: config.get<number>('agent.researchAgentTimeoutMs'),
      researchAgentModel: config.get<string>('agent.researchAgentModel'),
      researchAgentBaseUrl: config.get<string>('agent.researchAgentBaseUrl'),
      orchestrationEnabled: config.get<boolean>('agent.orchestrationEnabled'),
      stepMaxRetries: config.get<number>('agent.stepMaxRetries'),
      finalValidationEnabled: config.get<boolean>('agent.finalValidationEnabled'),
      showDiffPreview: config.get<boolean>('agent.showDiffPreview'),
      verifyCommands: config.get<string[]>('agent.verifyCommands'),
      verifyOnActComplete: config.get<boolean>('agent.verifyOnActComplete'),
      askModel: config.get<string>('agent.askModel'),
      askBaseUrl: config.get<string>('agent.askBaseUrl'),
      askProviderType: config.get<string>('agent.askProviderType'),
      planModel: config.get<string>('agent.planModel'),
      planBaseUrl: config.get<string>('agent.planBaseUrl'),
      planProviderType: config.get<string>('agent.planProviderType'),
      actModel: config.get<string>('agent.actModel'),
      actBaseUrl: config.get<string>('agent.actBaseUrl'),
      actProviderType: config.get<string>('agent.actProviderType'),
      checkpointStrategy: config.get<string>('agent.checkpointStrategy'),
    },
    mcp: {
      enabled: config.get<boolean>('mcp.enabled'),
      preloadBuiltin: config.get<boolean>('mcp.preloadBuiltin'),
      builtinServers: config.get<Record<string, unknown>>('mcp.builtinServers'),
      maxConcurrentStartup: config.get<number>('mcp.maxConcurrentStartup'),
      servers: config.get<Record<string, unknown>>('mcp.servers'),
    },
    workspace: {
      rootPathOverride: config.get<string>('workspace.rootPathOverride'),
    },
    scm: {
      commitMessageEnabled: config.get<boolean>('scm.commitMessageEnabled'),
    },
    github: {
      issueFetchEnabled: config.get<boolean>('github.issueFetchEnabled'),
      issueCommentLimit: config.get<number>('github.issueCommentLimit'),
      tokenRef: config.get<string>('github.tokenRef'),
      autoPrEnabled: config.get<boolean>('github.autoPrEnabled'),
      defaultBaseBranch: config.get<string>('github.defaultBaseBranch'),
      webhookSecret: config.get<string>('github.webhookSecret'),
      lazyMcpActivation: config.get<boolean>('github.lazyMcpActivation'),
      requireApprovalForRemoteWrites: config.get<boolean>('github.requireApprovalForRemoteWrites'),
      workflowDispatchEnabled: config.get<boolean>('github.workflowDispatchEnabled'),
    },
    telemetry: {
      sessionLogging: config.get<boolean>('telemetry.sessionLogging'),
      debugMetrics: config.get<boolean>('telemetry.debugMetrics'),
      webhookUrl: config.get<string>('telemetry.webhookUrl'),
      webhookSecret: config.get<string>('telemetry.webhookSecret'),
      webhookTimeoutMs: config.get<number>('telemetry.webhookTimeoutMs'),
    },
    ui: {
      showReasoning: config.get<boolean>('ui.showReasoning'),
      reasoningPreviewMaxChars: config.get<number>('ui.reasoningPreviewMaxChars'),
    },
    enterprise: {
      localProvidersOnly: config.get<boolean>('enterprise.localProvidersOnly'),
      stripFileContentsFromAuditPacks: config.get<boolean>('enterprise.stripFileContentsFromAuditPacks'),
      autoExportAuditPackOnSessionEnd: config.get<boolean>('enterprise.autoExportAuditPackOnSessionEnd'),
      channelsDisabled: config.get<boolean>('enterprise.channelsDisabled'),
      maxParallel: config.get<number>('enterprise.maxParallel'),
    },
  };

  const result = ThunderConfigSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return defaultThunderConfig();
}

function createMitiiConfigReader(): { get<T>(path: string): T | undefined } {
  const current = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION);
  return {
    get<T>(path: string): T | undefined {
      if (hasConfiguredValue(current.inspect<T>(path))) {
        return current.get<T>(path);
      }
      if (hasConfiguredValue(legacy.inspect<T>(path))) {
        return legacy.get<T>(path);
      }
      return current.get<T>(path);
    },
  };
}

function hasConfiguredValue(inspect: ReturnType<vscode.WorkspaceConfiguration['inspect']>): boolean {
  if (!inspect) return false;
  return [
    inspect.globalValue,
    inspect.workspaceValue,
    inspect.workspaceFolderValue,
    inspect.defaultLanguageValue,
    inspect.globalLanguageValue,
    inspect.workspaceLanguageValue,
    inspect.workspaceFolderLanguageValue,
  ].some((value) => value !== undefined);
}
