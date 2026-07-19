import type { FeatureModule, FeatureRegistrationContext } from '../../interfaces/feature';
import type { ToolFactoryContribution } from '../../interfaces/tools';
import type { ContextSourceContribution } from '../../interfaces/context';
import type { CeSessionServices } from './tools/sessionServices';
import { filesystemToolFactories } from './tools/factories/filesystemTools';
import { gitToolFactories } from './tools/factories/gitTools';
import { contextToolFactories } from './tools/factories/contextTools';
import { memoryToolFactories } from './tools/factories/memoryTools';
import { skillsToolFactories } from './tools/factories/skillsTools';
import { auditToolFactories } from './tools/factories/auditTools';
import { askModeToolFactories } from './tools/factories/askModeTools';
import { agentModeToolFactories } from './tools/factories/agentModeTools';
import { planModeToolFactories } from './tools/factories/planModeTools';
import { ceContextSourceFactories } from './context/factories/ceContextSources';
import { llmProviderFactories } from './providers/factories/llmProviderFactories';
import type { LlmProviderContribution } from '../../interfaces/llm';

/** Placeholder for feature domains not yet wired to real contributions. See `docs/architecture/enterprise-migration-plan.md`. */
function feature(id: string, displayName: string, description: string, requires: readonly string[] = []): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ce',
      version: '1.0.0',
      displayName,
      description,
      requires,
    },
    register() {},
  };
}

/** A feature module whose `register()` body registers a fixed list of real `ToolFactoryContribution`s. */
function toolsFeature(
  id: string,
  displayName: string,
  description: string,
  factories: readonly ToolFactoryContribution<unknown, CeSessionServices>[],
  requires: readonly string[] = []
): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ce',
      version: '1.0.0',
      displayName,
      description,
      requires,
    },
    register(context: FeatureRegistrationContext) {
      for (const contribution of factories) {
        context.tools.register(contribution);
      }
    },
  };
}

/** A feature module whose `register()` body registers both real tools and real context sources. */
function toolsAndContextFeature(
  id: string,
  displayName: string,
  description: string,
  toolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[],
  contextSourceFactories: readonly ContextSourceContribution<CeSessionServices>[],
  requires: readonly string[] = []
): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ce',
      version: '1.0.0',
      displayName,
      description,
      requires,
    },
    register(context: FeatureRegistrationContext) {
      for (const contribution of toolFactories) {
        context.tools.register(contribution);
      }
      for (const contribution of contextSourceFactories) {
        context.contextSources.register(contribution);
      }
    },
  };
}

/** A feature module whose `register()` body registers a fixed list of real `LlmProviderContribution`s. */
function providersFeature(
  id: string,
  displayName: string,
  description: string,
  factories: readonly LlmProviderContribution[],
  requires: readonly string[] = []
): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ce',
      version: '1.0.0',
      displayName,
      description,
      requires,
    },
    register(context: FeatureRegistrationContext) {
      for (const contribution of factories) {
        context.providers.register(contribution);
      }
    },
  };
}

export const ceFeatureModules: readonly FeatureModule[] = [
  feature('ce.runtime.session', 'Session Runtime', 'Session state, recovery, and lifecycle contracts.'),
  feature('ce.runtime.agent-loop', 'Agent Loop', 'Core model/tool execution loop.', ['ce.runtime.session']),
  toolsFeature('ce.mode.ask', 'Ask Mode', 'Read-oriented question answering mode.', askModeToolFactories, ['ce.runtime.agent-loop']),
  toolsFeature('ce.mode.plan', 'Plan Mode', 'Structured planning mode.', planModeToolFactories, ['ce.runtime.agent-loop']),
  toolsFeature('ce.mode.agent', 'Agent Mode', 'Workspace-changing execution mode.', agentModeToolFactories, ['ce.runtime.agent-loop']),
  toolsFeature('ce.tools.filesystem', 'Filesystem Tools', 'Workspace read, write, search, and patch tools.', filesystemToolFactories),
  toolsFeature('ce.tools.git', 'Git Tools', 'Git status, diff, log, release, and SCM helpers.', gitToolFactories),
  toolsAndContextFeature(
    'ce.context.indexing',
    'Indexing Context',
    'Workspace scanning, language service, FTS, vectors, and retrieval.',
    contextToolFactories,
    ceContextSourceFactories
  ),
  toolsFeature('ce.context.memory', 'Memory', 'Local memory extraction and passive memory injection.', memoryToolFactories),
  toolsFeature('ce.skills', 'Skills', 'Bundled and workspace skill catalog support.', skillsToolFactories),
  feature('ce.mcp', 'MCP', 'Workspace MCP configuration, transports, and tool bridging.'),
  toolsFeature('ce.audit.local', 'Local Audit', 'Local session logging and audit pack export.', auditToolFactories),
  providersFeature('ce.providers', 'Providers', 'Community LLM provider descriptors and factories.', llmProviderFactories),
  feature('ce.github', 'GitHub', 'GitHub issue, PR, and workflow helpers.'),
] as const;
