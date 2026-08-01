import { TaskAnalysisSchema, taskAnalyzerInputSchema } from "./contracts";
import type { TaskAnalysis, TaskAnalyzerInput } from "./contracts";
import { RulewiseTaskAnalyzer } from "./classifier/rule/RulewiseTaskAnalyzer";

export interface TaskAnalyzerDependencies {
  ruleAnalyzer?: RulewiseTaskAnalyzer;
}

/**
 * Deterministic task-shape analyzer used after intent classification.
 *
 * Does not classify intent, inspect repository contents, create execution
 * plans, or make execution-policy decisions.
 */
export class TaskAnalyzer {
  private readonly ruleAnalyzer: RulewiseTaskAnalyzer;

  constructor(dependencies: TaskAnalyzerDependencies = {}) {
    this.ruleAnalyzer =
      dependencies.ruleAnalyzer ?? new RulewiseTaskAnalyzer();
  }

  public analyze(input: TaskAnalyzerInput): TaskAnalysis {
    const normalizedInput = taskAnalyzerInputSchema.parse(input);
    const analysis = this.ruleAnalyzer.analyze(normalizedInput);

    return TaskAnalysisSchema.parse(analysis);
  }
}
