import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_LIMITS,
  CONTEXT_ASSEMBLY_MESSAGES,
} from "./constants";

import {
  ContextAssemblyError,
} from "./ContextAssemblyError";

import type {
  ContextContentSource,
  ContextContentSourceRegistryPort,
  ContextContentSourceRequest,
} from "./types";

export class ContextContentSourceRegistry
  implements ContextContentSourceRegistryPort
{
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .SOURCE_REGISTRY;

  private readonly sources =
    new Map<
      string,
      ContextContentSource
    >();

  private frozen = false;

  public register(
    source:
      ContextContentSource,
  ): void {
    this.assertMutable();

    if (
      this.sources.has(
        source.id,
      )
    ) {
      throw new ContextAssemblyError(
        `${CONTEXT_ASSEMBLY_MESSAGES.DUPLICATE_SOURCE} Source ID: "${source.id}".`,
        {
          operation:
            "register_source",
          componentId:
            this.id,
        },
      );
    }

    if (
      this.sources.size >=
      CONTEXT_ASSEMBLY_LIMITS
        .MAXIMUM_SOURCE_COUNT
    ) {
      throw new ContextAssemblyError(
        `Context content source limit of ${CONTEXT_ASSEMBLY_LIMITS.MAXIMUM_SOURCE_COUNT} was reached.`,
        {
          operation:
            "register_source",
          componentId:
            this.id,
        },
      );
    }

    this.sources.set(
      source.id,
      source,
    );
  }

  public unregister(
    sourceId: string,
  ): boolean {
    this.assertMutable();

    return this.sources.delete(
      sourceId,
    );
  }

  public freeze(): void {
    this.frozen = true;
  }

  public isFrozen(): boolean {
    return this.frozen;
  }

  public list():
    readonly ContextContentSource[] {
    return [
      ...this.sources.values(),
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
    request:
      ContextContentSourceRequest,
  ): readonly ContextContentSource[] {
    return this.list()
      .filter(
        (source) =>
          source.supports(
            request,
          ),
      );
  }

  private assertMutable(): void {
    if (!this.frozen) {
      return;
    }

    throw new ContextAssemblyError(
      CONTEXT_ASSEMBLY_MESSAGES
        .REGISTRY_FROZEN,
      {
        operation:
          "register_source",
        componentId:
          this.id,
      },
    );
  }
}
