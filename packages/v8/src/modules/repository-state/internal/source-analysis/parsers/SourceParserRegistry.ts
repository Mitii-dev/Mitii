import type {
  SourceLanguageId,
  SourceParser,
  SourceParserResolution,
} from "../types";

export class SourceParserRegistry {
  private readonly parsers =
    new Map<string, SourceParser>();

  constructor(
    parsers:
      readonly SourceParser[] = [],
  ) {
    for (const parser of parsers) {
      this.register(parser);
    }
  }

  public register(
    parser: SourceParser,
  ): void {
    if (
      this.parsers.has(parser.id)
    ) {
      throw new Error(
        `Source parser "${parser.id}" is already registered.`,
      );
    }

    if (
      !Number.isFinite(
        parser.priority,
      )
    ) {
      throw new RangeError(
        `Source parser "${parser.id}" priority must be finite.`,
      );
    }

    this.parsers.set(
      parser.id,
      parser,
    );
  }

  public unregister(
    parserId: string,
  ): boolean {
    return this.parsers.delete(
      parserId,
    );
  }

  public resolve(
    language: SourceLanguageId,
    relativePath: string,
  ): SourceParserResolution {
    const parsers =
      [...this.parsers.values()]
        .filter((parser) =>
          parser.supports(
            language,
            relativePath,
          ),
        )
        .sort(
          (left, right) =>
            right.priority -
              left.priority ||
            left.id.localeCompare(
              right.id,
            ),
        );

    return {
      language,
      parsers,
    };
  }

  public list():
    readonly SourceParser[] {
    return [...this.parsers.values()]
      .sort(
        (left, right) =>
          right.priority -
            left.priority ||
          left.id.localeCompare(
            right.id,
          ),
      );
  }
}

