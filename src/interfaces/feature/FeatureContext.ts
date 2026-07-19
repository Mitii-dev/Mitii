import type { CommandContribution } from '../commands/CommandContribution';
import type { ContextSourceContribution } from '../context/ContextSource';
import type { LlmProviderContribution } from '../llm/LlmProvider';
import type { McpContribution } from '../mcp/McpContribution';
import type { ModeContribution } from '../modes/ModeContribution';
import type { PolicyContribution } from '../policy/PolicyContribution';
import type { SettingsContribution } from '../config/SettingsContribution';
import type { SkillContribution } from '../skills/SkillContribution';
import type { TelemetryEventSinkContribution } from '../telemetry/EventSink';
import type { ToolFactoryContribution } from '../tools/Tool';
import type { UiContribution } from '../ui/UiContribution';

export interface ContributionRegistrar<TContribution> {
  register(contribution: TContribution): void;
}

export interface FeatureRegistrationContext {
  readonly tools: ContributionRegistrar<ToolFactoryContribution>;
  readonly providers: ContributionRegistrar<LlmProviderContribution>;
  readonly contextSources: ContributionRegistrar<ContextSourceContribution>;
  readonly commands: ContributionRegistrar<CommandContribution>;
  readonly settings: ContributionRegistrar<SettingsContribution>;
  readonly policies: ContributionRegistrar<PolicyContribution>;
  readonly eventSinks: ContributionRegistrar<TelemetryEventSinkContribution>;
  readonly modes: ContributionRegistrar<ModeContribution>;
  readonly skills: ContributionRegistrar<SkillContribution>;
  readonly mcp: ContributionRegistrar<McpContribution>;
  readonly ui: ContributionRegistrar<UiContribution>;
}
