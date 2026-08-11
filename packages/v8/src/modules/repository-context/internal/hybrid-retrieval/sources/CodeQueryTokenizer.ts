import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_QUERY_STOP_WORDS,
} from "../constants";
import {
  splitCodeIdentifier,
} from "../../../../repository-state/internal/text-index/TextQueryNormalizer";

export class CodeQueryTokenizer {
  public tokenize(
    query: string,
  ): string[] {
    const matches =
      query.match(
        /[A-Za-z_$][A-Za-z0-9_$]*/g,
      ) ?? [];

    const tokens:
      string[] = [];
    const seen =
      new Set<string>();

    for (const match of matches) {
      for (const token of [
        match.toLowerCase(),
        ...splitCodeIdentifier(match),
      ]) {
        if (
          token.length <
            HYBRID_RETRIEVAL_DEFAULTS
              .MINIMUM_QUERY_TOKEN_CHARACTERS ||
          HYBRID_RETRIEVAL_QUERY_STOP_WORDS
            .has(token) ||
          seen.has(token)
        ) {
          continue;
        }

        seen.add(token);
        tokens.push(token);

        if (
          tokens.length >=
          HYBRID_RETRIEVAL_DEFAULTS
            .MAXIMUM_QUERY_TOKENS
        ) {
          break;
        }
      }

      if (
        tokens.length >=
        HYBRID_RETRIEVAL_DEFAULTS
          .MAXIMUM_QUERY_TOKENS
      ) {
        break;
      }
    }

    return tokens;
  }
}
