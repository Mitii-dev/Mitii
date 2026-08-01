import {
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import type {
  ContextAssemblyWarning,
} from "./types";

export class ContextAssemblyWarningAggregator {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .WARNING_AGGREGATOR;

  public aggregate(
    warnings:
      readonly ContextAssemblyWarning[],
  ): ContextAssemblyWarning[] {
    const byKey =
      new Map<
        string,
        ContextAssemblyWarning
      >();

    for (
      const warning
      of warnings
    ) {
      const key = [
        warning.code,
        warning.message,
        warning.selectionKey ??
          "",
        warning.relativePath ??
          "",
        warning.sourceId ??
          "",
      ].join("\u0000");
      const existing =
        byKey.get(key);

      if (!existing) {
        byKey.set(
          key,
          {
            ...warning,
          },
        );
        continue;
      }

      existing.count =
        (
          existing.count ??
          1
        ) +
        (
          warning.count ??
          1
        );
    }

    return [
      ...byKey.values(),
    ];
  }
}
