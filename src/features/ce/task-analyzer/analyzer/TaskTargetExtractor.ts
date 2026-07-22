import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  ReferencedArtifact,
  TaskAnalysisSignal,
  TaskTarget,
} from "../types";

const FOLDER_REFERENCE_PATTERN =
  /(?:^|[\s"'`])((?:\.{1,2}\/|[a-zA-Z0-9_-]+\/)(?:[a-zA-Z0-9_.-]+\/)+)(?=$|[\s"'`,.;:!?)\]}])/g;

const SYMBOL_REFERENCE_PATTERN =
  /(?:^|[\s"'`])(?:function|method|class|interface|type|component|symbol)\s+[`'"]?([a-zA-Z_$][a-zA-Z0-9_$]*)[`'"]?/gi;

export class TaskTargetExtractor {
  public extract(
    userMessage: string,
    referencedArtifacts: readonly ReferencedArtifact[] = [],
  ): TaskTarget[] {
    const targets: TaskTarget[] = [];
    const seen = new Set<string>();

    this.extractArtifactTargets(referencedArtifacts, targets, seen);
    this.extractFileTargets(userMessage, targets, seen);
    this.extractFolderTargets(userMessage, targets, seen);
    this.extractSymbolTargets(userMessage, targets, seen);
    this.extractScopeTargets(userMessage, targets, seen);

    return targets;
  }

  public extractWithSignals(
    userMessage: string,
    referencedArtifacts: readonly ReferencedArtifact[] = [],
  ): {
    targets: TaskTarget[];
    signals: TaskAnalysisSignal[];
  } {
    const targets = this.extract(userMessage, referencedArtifacts);

    const signals: TaskAnalysisSignal[] = targets.map((target) => ({
      type: "scope",
      value: `${target.kind}:${target.value}`,
      weight: target.explicit ? 0.9 : 1,
      evidence: target.explicit
        ? `Explicit ${target.kind} target found in the user message: ${target.value}`
        : `Implicit ${target.kind} target supplied through referenced artifacts: ${target.value}`,
    }));

    return {
      targets,
      signals,
    };
  }

  private extractArtifactTargets(
    artifacts: readonly ReferencedArtifact[],
    targets: TaskTarget[],
    seen: Set<string>,
  ): void {
    for (const artifact of artifacts) {
      const value = artifact.path?.trim() || artifact.name.trim();

      if (!value) {
        continue;
      }

      this.addTarget(targets, seen, {
        kind: this.mapArtifactKind(artifact),
        value,
        explicit: false,
      });
    }
  }

  private extractFileTargets(
    userMessage: string,
    targets: TaskTarget[],
    seen: Set<string>,
  ): void {
    const pattern =
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.FILE_REFERENCE_PATTERN;

    for (const match of userMessage.matchAll(
      this.cloneGlobalPattern(pattern),
    )) {
      const value = this.cleanTargetValue(match[1] ?? match[0]);

      if (!value) {
        continue;
      }

      this.addTarget(targets, seen, {
        kind: "file",
        value,
        explicit: true,
      });
    }
  }

  private extractFolderTargets(
    userMessage: string,
    targets: TaskTarget[],
    seen: Set<string>,
  ): void {
    for (const match of userMessage.matchAll(FOLDER_REFERENCE_PATTERN)) {
      const value = this.cleanTargetValue(match[1] ?? match[0]);

      if (!value || this.looksLikeFile(value)) {
        continue;
      }

      this.addTarget(targets, seen, {
        kind: "folder",
        value: value.replace(/\/+$/, ""),
        explicit: true,
      });
    }
  }

  private extractSymbolTargets(
    userMessage: string,
    targets: TaskTarget[],
    seen: Set<string>,
  ): void {
    for (const match of userMessage.matchAll(SYMBOL_REFERENCE_PATTERN)) {
      const value = match[1]?.trim();

      if (!value) {
        continue;
      }

      this.addTarget(targets, seen, {
        kind: "symbol",
        value,
        explicit: true,
      });
    }
  }

  private extractScopeTargets(
    userMessage: string,
    targets: TaskTarget[],
    seen: Set<string>,
  ): void {
    const patterns = TASK_ANALYZER_CONSTANTS.SCOPE_PATTERNS;

    if (patterns.WORKSPACE_SCOPE_PATTERN.test(userMessage)) {
      this.addTarget(targets, seen, {
        kind: "workspace",
        value: "workspace",
        explicit: true,
      });

      return;
    }

    if (patterns.REPOSITORY_SCOPE_PATTERN.test(userMessage)) {
      this.addTarget(targets, seen, {
        kind: "repository",
        value: "repository",
        explicit: true,
      });

      return;
    }

    if (patterns.PACKAGE_SCOPE_PATTERN.test(userMessage)) {
      this.addTarget(targets, seen, {
        kind: "package",
        value: "package",
        explicit: true,
      });
    }
  }

  private mapArtifactKind(artifact: ReferencedArtifact): TaskTarget["kind"] {
    switch (artifact.kind) {
      case "file":
        return "file";

      case "folder":
        return "folder";

      case "selection":
        return artifact.path ? "file" : "symbol";

      case "attachment":
        return artifact.path ? "file" : "unknown";

      default:
        return "unknown";
    }
  }

  private addTarget(
    targets: TaskTarget[],
    seen: Set<string>,
    target: TaskTarget,
  ): void {
    const normalizedValue = this.normalizeForComparison(target.value);
    const key = `${target.kind}:${normalizedValue}`;

    if (!normalizedValue || seen.has(key)) {
      return;
    }

    seen.add(key);
    targets.push(target);
  }

  private looksLikeFile(value: string): boolean {
    return /(?:^|\/)[^/]+\.[a-zA-Z0-9]+$/.test(value);
  }

  private cleanTargetValue(value: string): string {
    return value
      .trim()
      .replace(/^[`'"]+/, "")
      .replace(/[`'",.;:!?)\]}]+$/, "");
  }

  private normalizeForComparison(value: string): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      .toLowerCase();
  }

  private cloneGlobalPattern(pattern: RegExp): RegExp {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;

    return new RegExp(pattern.source, flags);
  }
}
