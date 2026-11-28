import { createHash } from "node:crypto";

export class ContentHasher {
  public hashText(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }

  /**
   * Length-prefixing prevents ambiguous combinations.
   *
   * ["ab", "c"] and ["a", "bc"] produce different hashes.
   */
  public hashValues(values: readonly string[]): string {
    const hash = createHash("sha256");

    for (const value of values) {
      hash.update(String(value.length), "utf8");

      hash.update(":", "utf8");
      hash.update(value, "utf8");
      hash.update("\n", "utf8");
    }

    return hash.digest("hex");
  }
}
