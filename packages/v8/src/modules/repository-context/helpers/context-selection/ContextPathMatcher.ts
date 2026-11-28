import {
  CONTEXT_SELECTION_DEFAULTS,
} from "./constants";

export class ContextPathMatcher {
  public isQueryMatch(
    query: string,
    relativePath: string,
  ): boolean {
    const queryLower =
      query.toLowerCase();
    const pathLower =
      relativePath
        .toLowerCase();
    const baseName =
      pathLower
        .split("/")
        .at(-1) ??
      pathLower;
    const extensionIndex =
      baseName
        .lastIndexOf(".");
    const stem =
      extensionIndex > 0
        ? baseName.slice(
            0,
            extensionIndex,
          )
        : baseName;

    if (
      queryLower.includes(
        pathLower,
      ) ||
      queryLower.includes(
        baseName,
      )
    ) {
      return true;
    }

    return (
      stem.length >=
        CONTEXT_SELECTION_DEFAULTS
          .QUERY_STEM_MINIMUM_CHARACTERS &&
      queryLower.includes(stem)
    );
  }
}
