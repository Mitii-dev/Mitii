import type { PromptInstructionBlock } from "../../contracts";
import { FRAGMENT_POLICY } from "./fragmentPolicy";
import type { ContextualFragment, FragmentRole } from "./ContextualFragment";

export class BaseInstructionsFragment implements ContextualFragment {
  public readonly id = "system:core";

  constructor(private readonly text: string) {}

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return "generic.base_instructions";
  }

  requiresSeparateMessage(): boolean {
    return false;
  }

  markers(): readonly [string, string] {
    return ["", ""] as const;
  }

  body(): string {
    return this.text;
  }

  maxTokens(): number {
    return FRAGMENT_POLICY.absoluteMaxTokens;
  }

  section(): "system" {
    return "system";
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}

export class InstructionBlockFragment implements ContextualFragment {
  constructor(
    public readonly id: string,
    private readonly heading: string,
    private readonly block: PromptInstructionBlock,
    private readonly sectionName:
      | "rules"
      | "skills"
      | "memory"
      | "environment"
      | "plan",
    private readonly kindNamespace: string,
    private readonly options?: {
      readonly marked?: boolean;
      readonly separateMessage?: boolean;
    },
  ) {}

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return `${this.kindNamespace}.${this.block.id}`;
  }

  requiresSeparateMessage(): boolean {
    return this.options?.separateMessage === true;
  }

  /**
   * Environment / memory default to marked fragments (Codex discipline) so
   * mid-session reinjection and epoch mid-updates can be recognized later.
   * Rules/skills stay unmarked for classic single-system-blob compatibility
   * unless `options.marked` is set.
   */
  markers(): readonly [string, string] {
    if (this.options?.marked === false) {
      return ["", ""] as const;
    }
    if (
      this.options?.marked === true ||
      this.sectionName === "environment" ||
      this.sectionName === "memory"
    ) {
      const tag = this.sectionName;
      return [`<${tag}_fragment id="${this.block.id}">`, `</${tag}_fragment>`] as const;
    }
    return ["", ""] as const;
  }

  body(): string {
    const title = this.block.title ?? this.block.id;
    return `## ${this.heading}: ${title}\n${this.block.content}`;
  }

  maxTokens(): number {
    // Environment values keep Codex additional-context hard budget.
    // Rules/skills/memory use absolute max; review threshold only flags.
    if (this.sectionName === "environment") {
      return Math.min(
        FRAGMENT_POLICY.additionalContextValueTokens,
        FRAGMENT_POLICY.absoluteMaxTokens,
      );
    }
    return FRAGMENT_POLICY.absoluteMaxTokens;
  }

  section(): "rules" | "skills" | "memory" | "environment" | "plan" {
    return this.sectionName;
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}

/**
 * Mid-Conversation System Message fragment (OpenCode chronological admission).
 * Always separate + marked so epoch admit can strip on replace.
 */
export class MidConversationUpdateFragment implements ContextualFragment {
  public readonly id: string;

  constructor(
    private readonly bodyText: string,
    idSuffix = "update",
  ) {
    this.id = `context_epoch:${idSuffix}`;
  }

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return "generic.context_epoch_update";
  }

  requiresSeparateMessage(): boolean {
    return true;
  }

  markers(): readonly [string, string] {
    return ["<context_epoch_update>", "</context_epoch_update>"] as const;
  }

  body(): string {
    return this.bodyText.trim();
  }

  maxTokens(): number {
    return FRAGMENT_POLICY.absoluteMaxTokens;
  }

  section(): "system" {
    return "system";
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}

export class DecisionBriefFragment implements ContextualFragment {
  public readonly id = "system:decision-brief";

  constructor(private readonly text: string) {}

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return "generic.decision_brief";
  }

  requiresSeparateMessage(): boolean {
    return false;
  }

  markers(): readonly [string, string] {
    return ["", ""] as const;
  }

  body(): string {
    return this.text.trim();
  }

  maxTokens(): number {
    return FRAGMENT_POLICY.absoluteMaxTokens;
  }

  section(): "system" {
    return "system";
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}

export class PlanGuidanceFragment implements ContextualFragment {
  public readonly id = "system:plan-guidance";

  constructor(private readonly text: string) {}

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return "generic.plan_guidance";
  }

  requiresSeparateMessage(): boolean {
    return false;
  }

  markers(): readonly [string, string] {
    return ["", ""] as const;
  }

  body(): string {
    return this.text;
  }

  maxTokens(): number {
    return FRAGMENT_POLICY.absoluteMaxTokens;
  }

  section(): "plan" {
    return "plan";
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}
