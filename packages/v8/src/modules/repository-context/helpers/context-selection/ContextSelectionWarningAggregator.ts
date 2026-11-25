import type {
  ContextSelectionWarning,
} from "./types";

export class ContextSelectionWarningAggregator {
  public aggregate(
    warnings:
      readonly ContextSelectionWarning[],
  ): ContextSelectionWarning[] {
    const aggregated =
      new Map<
        string,
        ContextSelectionWarning
      >();

    for (
      const warning of
        warnings
    ) {
      const key = [
        warning.code,
        warning.key ?? "",
        warning.relativePath ?? "",
        warning.message,
      ].join("\u0000");
      const existing =
        aggregated.get(key);

      if (!existing) {
        aggregated.set(
          key,
          {
            ...warning,
          },
        );
        continue;
      }

      const count =
        (
          existing.count ??
          1
        ) +
        (
          warning.count ??
          1
        );

      aggregated.set(
        key,
        {
          ...existing,
          count,
        },
      );
    }

    return [
      ...aggregated
        .values(),
    ].sort(
      (left, right) =>
        left.code
          .localeCompare(
            right.code,
          ) ||
        (
          left.relativePath ??
          ""
        ).localeCompare(
          right.relativePath ??
            "",
        ) ||
        (
          left.key ??
          ""
        ).localeCompare(
          right.key ??
            "",
        ),
    );
  }
}
