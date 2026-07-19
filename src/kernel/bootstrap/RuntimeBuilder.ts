import type { FeatureModule, FeatureRegistrationContext } from '../../interfaces/feature';
import type { HostPorts } from '../../interfaces/runtime';
import {
  CommandRegistry,
  ContextSourceRegistry,
  EventSinkRegistry,
  FeatureRegistry,
  McpRegistry,
  ModeRegistry,
  PolicyRegistry,
  ProviderRegistry,
  SettingsRegistry,
  SkillRegistry,
  ToolRegistry,
  UiRegistry,
} from '../registries';

export interface RuntimeRegistries {
  readonly tools: ToolRegistry;
  readonly providers: ProviderRegistry;
  readonly contextSources: ContextSourceRegistry;
  readonly commands: CommandRegistry;
  readonly settings: SettingsRegistry;
  readonly policies: PolicyRegistry;
  readonly eventSinks: EventSinkRegistry;
  readonly modes: ModeRegistry;
  readonly skills: SkillRegistry;
  readonly mcp: McpRegistry;
  readonly ui: UiRegistry;
}

export interface RuntimeBuilderOptions {
  readonly features: readonly FeatureModule[];
  readonly hostPorts: HostPorts;
}

export interface BuiltRuntime {
  readonly registries: RuntimeRegistries;
  readonly hostPorts: HostPorts;
  readonly features: readonly FeatureModule[];
}

function createRegistries(): RuntimeRegistries {
  return {
    tools: new ToolRegistry(),
    providers: new ProviderRegistry(),
    contextSources: new ContextSourceRegistry(),
    commands: new CommandRegistry(),
    settings: new SettingsRegistry(),
    policies: new PolicyRegistry(),
    eventSinks: new EventSinkRegistry(),
    modes: new ModeRegistry(),
    skills: new SkillRegistry(),
    mcp: new McpRegistry(),
    ui: new UiRegistry(),
  };
}

function createRegistrationContext(registries: RuntimeRegistries): FeatureRegistrationContext {
  return { ...registries };
}

function freezeAll(registries: RuntimeRegistries): void {
  for (const registry of Object.values(registries)) {
    registry.freeze();
  }
}

/**
 * Host-neutral composition root. Both the VS Code adapter (`ThunderController`) and the
 * Node adapter (`HeadlessAgentHost`) call this with the same CE (+ EE, where composed)
 * feature list and their own `HostPorts` implementation, so tool/provider/context-source
 * registration only happens in one place instead of being duplicated per host.
 */
export function buildRuntime(options: RuntimeBuilderOptions): BuiltRuntime {
  const featureRegistry = new FeatureRegistry();
  for (const feature of options.features) {
    featureRegistry.register(feature);
  }

  const activationOrder = featureRegistry.resolveActivationOrder();
  const registries = createRegistries();
  const context = createRegistrationContext(registries);

  for (const feature of activationOrder) {
    feature.register(context);
  }

  featureRegistry.freeze();
  freezeAll(registries);

  return {
    registries,
    hostPorts: options.hostPorts,
    features: activationOrder,
  };
}
