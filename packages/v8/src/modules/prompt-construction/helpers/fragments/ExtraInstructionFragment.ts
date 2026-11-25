import type { PromptExtraFragment } from "../../contracts";
import type { ContextualFragment, FragmentRole } from "./ContextualFragment";
import { FRAGMENT_POLICY } from "./fragmentPolicy";

/**
 * Adapter: serializable PromptExtraFragment DTO → ContextualFragment.
 * Hosts/engine inject typed extras without forking buildSystemInstructions.
 */
export class ExtraInstructionFragment implements ContextualFragment {
  public readonly id: string;

  constructor(
    private readonly spec: PromptExtraFragment,
    private readonly limits?: {
      readonly absoluteMaxTokens?: number;
      readonly additionalContextValueTokens?: number;
    },
  ) {
    this.id = spec.id;
  }

  role(): FragmentRole {
    return this.spec.role;
  }

  contentKind(): string {
    return this.spec.contentKind;
  }

  requiresSeparateMessage(): boolean {
    return this.spec.separateMessage === true;
  }

  markers(): readonly [string, string] {
    if (this.spec.marked === true) {
      const tag = this.spec.section;
      return [
        `<${tag}_fragment id="${escapeAttr(this.spec.id)}">`,
        `</${tag}_fragment>`,
      ] as const;
    }
    return ["", ""] as const;
  }

  body(): string {
    return this.spec.content;
  }

  maxTokens(): number {
    const absolute =
      this.limits?.absoluteMaxTokens ?? FRAGMENT_POLICY.absoluteMaxTokens;
    const requested = this.spec.maxTokens ?? absolute;
    if (this.spec.section === "environment") {
      return Math.min(
        requested,
        this.limits?.additionalContextValueTokens ??
          FRAGMENT_POLICY.additionalContextValueTokens,
        absolute,
      );
    }
    return Math.min(requested, absolute);
  }

  section():
    | "system"
    | "rules"
    | "skills"
    | "memory"
    | "plan"
    | "repository"
    | "environment" {
    return this.spec.section;
  }

  trust(): ReturnType<ContextualFragment["trust"]> {
    return this.spec.trust;
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
