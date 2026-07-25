import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskScope,
  TaskScopeAnalysis,
  TaskScopeAnalyzerInput,
  TaskScopeSignal,
  TaskTarget,
} from "../contracts";

export class TaskScopeAnalyzer {
  public estimateScope(input: TaskScopeAnalyzerInput): TaskScope {
    return this.analyzeScope(input).scope;
  }

  public analyzeScope(input: TaskScopeAnalyzerInput): TaskScopeAnalysis {
    const text = input.userMessage.trim();
    const targets = this.deduplicateTargets(input.targets);
    const signals: TaskScopeSignal[] = [];
    const scopeThresholds = TASK_ANALYZER_CONSTANTS.THRESHOLDS.SCOPE;

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.WORKSPACE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "workspace",
        confidence: scopeThresholds.WORKSPACE,
        evidence: "Workspace-wide or cross-package language was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.REPOSITORY_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "repository",
        confidence: scopeThresholds.REPOSITORY,
        evidence: "Repository-wide or project-wide language was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.PACKAGE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "package",
        confidence: scopeThresholds.PACKAGE,
        evidence: "Package, module, library, or service scope was detected.",
      });

      return this.buildResult(signals);
    }

    if (
      TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.MULTI_FILE_SCOPE_PATTERN.test(text)
    ) {
      signals.push({
        scope: "multi_file",
        confidence: scopeThresholds.MULTI_FILE,
        evidence: "The request explicitly mentions multiple files.",
      });
    }

    const targetScope = this.analyzeTargetScope(targets, scopeThresholds);

    if (targetScope) {
      signals.push(targetScope);
    }

    if (TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS.LOCAL_SCOPE_PATTERN.test(text)) {
      signals.push({
        scope: "single_location",
        confidence: scopeThresholds.LOCAL,
        evidence: "The request explicitly refers to one local code location.",
      });
    }

    if (signals.length === 0) {
      return {
        scope: "unknown",
        confidence: scopeThresholds.UNKNOWN,
        signals: [
          {
            scope: "unknown",
            confidence: scopeThresholds.UNKNOWN,
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
    scopeThresholds: typeof TASK_ANALYZER_CONSTANTS.THRESHOLDS.SCOPE,
  ): TaskScopeSignal | null {
    if (targets.length === 0) {
      return null;
    }

    if (targets.length > 1) {
      return {
        scope: "multi_file",
        confidence: scopeThresholds.MULTI_TARGET,
        evidence: `${targets.length} distinct task targets were identified.`,
      };
    }

    const target = targets[0];

    if (target.kind === "package") {
      return {
        scope: "package",
        confidence: scopeThresholds.PACKAGE_TARGET,
        evidence: `A package target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "repository") {
      return {
        scope: "repository",
        confidence: scopeThresholds.PACKAGE_TARGET,
        evidence: `A repository target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "workspace") {
      return {
        scope: "workspace",
        confidence: scopeThresholds.PACKAGE_TARGET,
        evidence: `A workspace target was identified: ${target.value}.`,
      };
    }

    if (target.kind === "folder" && this.looksLikePackageTarget(target.value)) {
      return {
        scope: "package",
        confidence: scopeThresholds.PACKAGE_FOLDER,
        evidence: `The folder target appears to identify a package or service: ${target.value}.`,
      };
    }

    return {
      scope: "single_location",
      confidence: scopeThresholds.SINGLE_TARGET,
      evidence: `One explicit target was identified: ${target.value}.`,
    };
  }

  private buildResult(signals: TaskScopeSignal[]): TaskScopeAnalysis {
    const priority = TASK_ANALYZER_CONSTANTS.SCOPE_PRIORITY;

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
    return TASK_ANALYZER_CONSTANTS.TARGET_PATTERNS.PACKAGE_FOLDER.test(
      value.replace(/\\/g, "/"),
    );
  }
}
