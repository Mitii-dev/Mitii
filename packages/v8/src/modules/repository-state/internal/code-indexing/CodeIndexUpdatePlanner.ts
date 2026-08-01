import {
  metadataChanged,
} from "./constants";

import {
  codeIndexUpdatePlanSchema,
} from "./schema";

import type {
  CodeIndexUpdatePlan,
  CodeIndexUpdatePlannerInput,
} from "./types";

export class CodeIndexUpdatePlanner {
  public plan(
    input: CodeIndexUpdatePlannerInput,
  ): CodeIndexUpdatePlan {
    if (input.removed) {
      return this.validate({
        action: "remove",
        reason: "file_removed",
      });
    }

    if (!input.desired) {
      throw new RangeError(
        "A non-removal update requires desired file state.",
      );
    }

    if (!input.current) {
      return this.validate({
        action: "insert",
        reason: "file_not_indexed",
      });
    }

    if (
      input.desired.contentHash !==
      input.current.contentHash
    ) {
      return this.validate({
        action: "replace",
        reason: "content_changed",
      });
    }

    if (
      input.desired.analysisVersion !==
      input.current.analysisVersion
    ) {
      return this.validate({
        action: "replace",
        reason:
          "analysis_version_changed",
      });
    }

    if (
      input.desired.analysisStatus !==
      input.current.analysisStatus
    ) {
      return this.validate({
        action: "replace",
        reason:
          "analysis_status_changed",
      });
    }

    if (metadataChanged(input)) {
      return this.validate({
        action: "refresh_metadata",
        reason: "metadata_changed",
      });
    }

    return this.validate({
      action: "skip",
      reason: "unchanged",
    });
  }

  private validate(
    plan: CodeIndexUpdatePlan,
  ): CodeIndexUpdatePlan {
    return codeIndexUpdatePlanSchema.parse(
      plan,
    ) as CodeIndexUpdatePlan;
  }
}
