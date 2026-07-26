import {
  VECTOR_INDEX_LANCEDB,
  VECTOR_INDEX_LIMITS,
  VECTOR_INDEX_PATTERNS,
} from "./constants";

export class VectorIndexTableNameBuilder {
  public build(
    prefix: string,
    profileId: string,
  ): string {
    this.validatePrefix(prefix);

    const profileSlug =
      profileId
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "_",
        )
        .replace(
          /^_+|_+$/g,
          "",
        )
        .slice(0, 32) ||
      "profile";

    return [
      prefix,
      profileSlug,
      this.hash(profileId),
    ].join("_");
  }

  public validatePrefix(
    prefix: string,
  ): void {
    if (
      prefix.length >
        VECTOR_INDEX_LIMITS
          .MAXIMUM_TABLE_NAME_PREFIX_CHARACTERS ||
      !VECTOR_INDEX_PATTERNS
        .TABLE_NAME_PREFIX
        .test(prefix)
    ) {
      throw new RangeError(
        "tableNamePrefix must contain only lowercase letters, digits, and underscores, and must start with a letter.",
      );
    }
  }

  private hash(
    value: string,
  ): string {
    let hash =
      VECTOR_INDEX_LANCEDB
        .TABLE_HASH_OFFSET_BASIS;

    for (
      let index = 0;
      index < value.length;
      index += 1
    ) {
      hash ^=
        value.charCodeAt(index);

      hash =
        Math.imul(
          hash,
          VECTOR_INDEX_LANCEDB
            .TABLE_HASH_PRIME,
        ) >>> 0;
    }

    return hash
      .toString(
        VECTOR_INDEX_LANCEDB
          .TABLE_HASH_RADIX,
      )
      .padStart(
        VECTOR_INDEX_LANCEDB
          .TABLE_HASH_LENGTH,
        "0",
      );
  }
}
