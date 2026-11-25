export class ChunkTextIndex {
  private readonly lineStarts:
    number[];

  constructor(
    private readonly content: string,
  ) {
    this.lineStarts = [0];

    for (
      let index = 0;
      index < content.length;
      index += 1
    ) {
      if (
        content[index] === "\n"
      ) {
        this.lineStarts.push(
          index + 1,
        );
      }
    }
  }

  public get lineCount(): number {
    return this.content.length === 0
      ? 0
      : this.lineStarts.length;
  }

  public lineStartOffset(
    oneBasedLine: number,
  ): number | undefined {
    if (
      !Number.isSafeInteger(
        oneBasedLine,
      ) ||
      oneBasedLine <= 0
    ) {
      return undefined;
    }

    return this.lineStarts[
      oneBasedLine - 1
    ];
  }

  public lineEndOffsetExclusive(
    oneBasedLine: number,
  ): number | undefined {
    const start =
      this.lineStartOffset(
        oneBasedLine,
      );

    if (start === undefined) {
      return undefined;
    }

    const next =
      this.lineStarts[
        oneBasedLine
      ];

    return next ??
      this.content.length;
  }

  public lineAtOffset(
    offset: number,
  ): number {
    if (
      this.content.length === 0
    ) {
      return 0;
    }

    const target = Math.max(
      0,
      Math.min(
        this.content.length - 1,
        offset,
      ),
    );

    let low = 0;
    let high =
      this.lineStarts.length - 1;

    while (low <= high) {
      const middle = Math.floor(
        (low + high) / 2,
      );

      const start =
        this.lineStarts[middle] ??
        0;

      const next =
        this.lineStarts[
          middle + 1
        ] ??
        this.content.length + 1;

      if (
        target >= start &&
        target < next
      ) {
        return middle + 1;
      }

      if (target < start) {
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }

    return this.lineStarts.length;
  }
}
