import type { AskRunPlan, ProjectCatalog } from './askTypes';
import { routeAskIntent } from './AskIntentRouter';
import { buildAskPromptContext } from './askPrompts';
import { discoverProjectCatalog } from './ProjectCatalog';
import { resolveAskScope } from './AskScopeResolver';

export interface AskPrepareOptions {
  workspaceRoot?: string;
  catalog?: ProjectCatalog;
  configuredMaxSteps?: number;
}

export class AskOrchestrator {
  static prepare(userMessage: string, options: AskPrepareOptions = {}): AskRunPlan {
    const route = routeAskIntent(userMessage);
    const catalog = options.catalog ?? (options.workspaceRoot ? discoverProjectCatalog(options.workspaceRoot) : undefined);
    const scope = resolveAskScope(userMessage, catalog);
    const maxSteps = resolveAskMaxSteps(route.profile, route.intent, options.configuredMaxSteps);

    return {
      route,
      catalog,
      scope,
      promptContext: buildAskPromptContext(userMessage, route, scope, catalog),
      maxSteps,
      autoContinue: route.groundingRequired && route.profile === 'deep',
      maxAutoContinues: route.profile === 'deep' ? 1 : 0,
    };
  }
}

function resolveAskMaxSteps(
  profile: string,
  intent: string,
  configuredMaxSteps: number | undefined
): number {
  if (configuredMaxSteps && configuredMaxSteps > 0) return configuredMaxSteps;
  if (profile === 'concise') return 8;
  if (intent === 'implement_here' || intent === 'architecture' || intent === 'cross_project') return 20;
  return 16;
}

export interface MitiiAskOptions {
  profile?: 'deep' | 'concise';
  scope?: string;
  includeImpact?: boolean;
  webSearch?: boolean;
}

export interface MitiiAskResult {
  text: string;
  projects: string[];
}

export interface MitiiAskRun {
  stream(): AsyncIterable<string>;
  wait(): Promise<MitiiAskResult>;
}

export interface MitiiHeadlessAskAgent {
  ask(message: string, options?: MitiiAskOptions): Promise<MitiiAskRun>;
}

export function createSdkCompatibilityNote(): string {
  return [
    'Ask is routed through a headless AskOrchestrator.prepare() boundary.',
    'A future @mitii/sdk can wrap the same route/scope/profile/impact decisions and expose Agent.ask().',
  ].join(' ');
}
