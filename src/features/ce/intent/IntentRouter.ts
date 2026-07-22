import type { LlmProvider } from "../../../kernel/llm/types";
import { LlmIntentClassifier, RuleIntentClassifier } from "./classifiers";
import { ModeIntentPolicy } from "./policy";
import { SuperIntent } from "./resolution";
import {
  IntentClassificationInput,
  IntentClassifierResult,
  IntentRouterDependencies,
  SuperIntentResult,
} from "./types";

/** Pending: Emitting Activity:  emitActivity */
export class IntentRouter {
  private readonly ruleClassifier: RuleIntentClassifier;
  private readonly llmClassifier: LlmIntentClassifier;
  private readonly modePolicy: ModeIntentPolicy;

  constructor(
    provider: LlmProvider,
    dependencies: IntentRouterDependencies = {},
  ) {
    this.ruleClassifier =
      dependencies.ruleClassifier ?? new RuleIntentClassifier();

    this.llmClassifier =
      dependencies.llmClassifier ?? new LlmIntentClassifier(provider);

    this.modePolicy = new ModeIntentPolicy();
  }

  async classify(input: IntentClassificationInput): Promise<SuperIntentResult> {
    const normalizedInput = this.normalizeInput(input);

    // 1. Attempt Rule classification first.
    const ruleClassification = this.ruleClassifier.classifyMessage(
      normalizedInput.userMessage,
    );
    const ruleResult = ruleClassification
      ? {
          source:
            ruleClassification.confidence === 1
              ? ("explicit_rule" as const)
              : ("heuristic_rule" as const),
          classification: ruleClassification,
          matchedRule: ruleClassification.reason,
        }
      : null;

    //2. Attempt LLM classification.
    const llmClassification = await this.modePolicy.apply(
      normalizedInput.mode,
      await this.llmClassifier.classify(normalizedInput),
    );
    const llmResult: IntentClassifierResult = {
      source: "llm",
      classification: llmClassification,
    };

    // 3. Resolve final classification using SuperIntent.
    const superIntent = new SuperIntent();
    const result = superIntent.resolve({
      mode: input.mode,
      ruleResult,
      llmResult,
    });

    return result;
  }

  private normalizeInput(
    input: IntentClassificationInput,
  ): Required<IntentClassificationInput> {
    return {
      mode: input.mode,
      userMessage: input.userMessage.trim(),
      referencedArtifacts: input.referencedArtifacts ?? [],
    };
  }
}
