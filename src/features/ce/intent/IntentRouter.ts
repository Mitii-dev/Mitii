import type { LlmProvider } from "../../../kernel/llm/types";
import type { IntentClassification } from "./schema";
import { RuleIntentClassifier, LlmIntentClassifier } from "./classifiers";
import { IntentClassificationInput, IntentRouterDependencies } from "./types";

export class IntentRouter {
  private readonly ruleClassifier: RuleIntentClassifier;
  private readonly llmClassifier: LlmIntentClassifier;

  constructor(
    provider: LlmProvider,
    dependencies: IntentRouterDependencies = {},
  ) {
    this.ruleClassifier =
      dependencies.ruleClassifier ?? new RuleIntentClassifier();

    this.llmClassifier =
      dependencies.llmClassifier ?? new LlmIntentClassifier(provider);
  }

  async classify(
    input: IntentClassificationInput,
  ): Promise<IntentClassification> {
    const normalizedInput = this.normalizeInput(input);
    if (normalizedInput.referencedArtifacts.length === 0) {
      const ruleClassification = this.ruleClassifier.classifyMessage(
        normalizedInput.userMessage,
      );

      if (ruleClassification) {
        return ruleClassification;
      }
    }

    return this.llmClassifier.classify(normalizedInput);
  }

  async classifyMessage(userMessage: string): Promise<IntentClassification> {
    return this.classify({
      userMessage,
      referencedArtifacts: [],
    });
  }

  private normalizeInput(
    input: IntentClassificationInput,
  ): Required<IntentClassificationInput> {
    return {
      userMessage: input.userMessage.trim(),
      referencedArtifacts: input.referencedArtifacts ?? [],
    };
  }
}
