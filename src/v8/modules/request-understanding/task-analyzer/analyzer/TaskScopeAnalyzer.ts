import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskScope,
  TaskScopeAnalysis,
  TaskScopeAnalyzerInput,
  TaskScopeSignal,
  TaskTarget,
} from "../types";

export class TaskScopeAnalyzer {
  /**
   * Returns only the final scope.
   */
  public estimateScope(input: TaskScopeAnalyzerInput): TaskScope {
    return this.analyzeScope(input).scope;
  }

  /**
   * Determines scope from explicit scope language and extracted targets.
   */
  public analyzeScope(input: TaskScopeAnalyzerInput): TaskScopeAnalysis {
    const text = input.userMessage.trim();
    const targets = this.deduplicateTargets(input.targets);

    const signals: TaskScopeSignal[] = [];

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.WORKSPACE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "workspace",
        confidence: 0.97,
        evidence: "Workspace-wide or cross-package language was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.REPOSITORY_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "repository",
        confidence: 0.95,
        evidence: "Repository-wide or project-wide language was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.PACKAGE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "package",
        confidence: 0.9,
        evidence: "Package, module, library, or service scope was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.MULTI_FILE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "multi_file",
        confidence: 0.88,
        evidence: "The request explicitly mentions multiple files.",
      });
    }

    const targetScope = this.analyzeTargetScope(targets);

    if (targetScope) {
      signals.push(targetScope);
    }

    if (TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.LOCAL_SCOPE_PATTERN.test(text)) {
      signals.push({
        scope: "single_location",
        confidence: 0.8,
        evidence: "The request explicitly refers to one local code location.",
      });
    }

    if (signals.length === 0) {
      return {
        scope: "unknown",
        confidence: 0.3,
        signals: [
          {
            scope: "unknown",
            confidence: 0.3,
            evidence:
              "No explicit scope language or usable targets were detected.",
          },
        ],
      };
    }

    return this.buildResult(signals);
  }

  private analyzeTargetScope(
    targets: readonly TaskTarget[],
  ): TaskScopeSignal | null {
    if (targets.length === 0) {
      return null;
    }

    if (targets.length > 1) {
      return {
        scope: "multi_file",
        confidence: 0.92,
        evidence: `${targets.length} distinct task targets were identified.`,
      };
    }

    const target = targets[0];

    if (target.kind === "package") {
      return {
        scope: "package",
        confidence: 0.95,
        evidence: `A package target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "repository") {
      return {
        scope: "repository",
        confidence: 0.95,
        evidence: `A repository target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "workspace") {
      return {
        scope: "workspace",
        confidence: 0.95,
        evidence: `A workspace target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "folder" && this.looksLikePackageTarget(target.value)) {
      return {
        scope: "package",
        confidence: 0.78,
        evidence: `The folder target appears to identify a package or service: ${target.value}.`,
      };
    }

    return {
      scope: "single_location",
      confidence: 0.9,
      evidence: `One explicit target was identified: ${target.value}.`,
    };
  }

  private buildResult(signals: TaskScopeSignal[]): TaskScopeAnalysis {
    const priority: Record<TaskScope, number> = {
      unknown: 0,
      single_location: 1,
      multi_file: 2,
      package: 3,
      repository: 4,
      workspace: 5,
    };

    const sorted = [...signals].sort((first, second) => {
      const priorityDifference = priority[second.scope] - priority[first.scope];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return second.confidence - first.confidence;
    });

    const selected = sorted[0];

    return {
      scope: selected.scope,
      confidence: selected.confidence,
      signals,
    };
  }

  private deduplicateTargets(targets: readonly TaskTarget[]): TaskTarget[] {
    const seen = new Set<string>();
    const uniqueTargets: TaskTarget[] = [];

    for (const target of targets) {
      const key = [
        target.kind,
        target.value.trim().replace(/\\/g, "/").toLowerCase(),
      ].join(":");

      if (!target.value.trim() || seen.has(key)) {
        continue;
      }

      seen.add(key);
      uniqueTargets.push(target);
    }

    return uniqueTargets;
  }

  private looksLikePackageTarget(value: string): boolean {
    return /(?:^|\/)(?:packages?|services?|apps?|libs?|modules?)\/[^/]+\/?$/i.test(
      value.replace(/\\/g, "/"),
    );
  }
}
