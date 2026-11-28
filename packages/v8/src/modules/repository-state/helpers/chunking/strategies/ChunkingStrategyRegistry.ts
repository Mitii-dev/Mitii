import {
  CHUNKING_ERRORS,
} from "../constants";

import type {
  ChunkingStrategy,
  ChunkingStrategyContext,
  ChunkingStrategyRegistryPort,
  ChunkingStrategyResolution,
} from "../types";

export class ChunkingStrategyRegistry
  implements ChunkingStrategyRegistryPort
{
  private readonly strategies =
    new Map<
      string,
      ChunkingStrategy
    >();

  private frozen = false;

  public register(
    strategy: ChunkingStrategy,
  ): void {
    this.assertMutable();

    if (
      this.strategies.has(
        strategy.id,
      )
    ) {
      throw new Error(
        `${CHUNKING_ERRORS.DUPLICATE_STRATEGY} "${strategy.id}".`,
      );
    }

    this.strategies.set(
      strategy.id,
      strategy,
    );
  }

  public unregister(
    strategyId: string,
  ): boolean {
    this.assertMutable();

    return this.strategies.delete(
      strategyId,
    );
  }

  public freeze(): void {
    this.frozen = true;
  }

  public isFrozen(): boolean {
    return this.frozen;
  }

  public list():
    readonly ChunkingStrategy[] {
    return [
      ...this.strategies
        .values(),
    ].sort(
      (left, right) =>
        right.priority -
          left.priority ||
        left.id.localeCompare(
          right.id,
        ),
    );
  }

  public resolve(
    context: ChunkingStrategyContext,
  ): ChunkingStrategyResolution {
    return {
      strategies:
        this.list().filter(
          (strategy) =>
            strategy.supports(
              context,
            ),
        ),
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new Error(
        CHUNKING_ERRORS
          .REGISTRY_FROZEN,
      );
    }
  }
}

