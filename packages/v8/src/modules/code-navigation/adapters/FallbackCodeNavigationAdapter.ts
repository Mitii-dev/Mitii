import { CODE_NAVIGATION_OPERATIONS } from "../constants";
import type {
  CodeNavigationCallOptions,
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from "../contracts";

/**
 * Tries the primary language-service port, then a degraded graph port.
 * `provider` reflects whichever adapter answered the last call.
 */
export class FallbackCodeNavigationAdapter implements CodeNavigationPort {
  public readonly id = "fallback-code-navigation";
  /**
   * Reflects the provider that answered the most recent navigation call.
   * Sequential tool-loop use only — not safe across concurrent navigate().
   */
  public provider: "language_server" | "repo_graph";

  constructor(
    private readonly options: {
      primary: CodeNavigationPort;
      fallback: CodeNavigationPort;
    },
  ) {
    this.provider = options.primary.provider;
  }

  public async definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () => this.options.primary.definition(input, options),
      () => this.options.fallback.definition(input, options),
    );
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.typeDefinition?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.typeDefinition?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async prepare(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void> {
    try {
      await this.options.primary.prepare?.(relativePath, options);
    } catch {
      // Primary prepare failure must not block graph fallback.
    }
    await this.options.fallback.prepare?.(relativePath, options);
  }

  public async references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () => this.options.primary.references(input, options),
      () => this.options.fallback.references(input, options),
    );
  }

  public async hover(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    try {
      const hover = await this.options.primary.hover?.(input, options);
      if (hover) {
        this.provider = this.options.primary.provider;
        return hover;
      }
    } catch {
      // Fall through to graph hover.
    }
    this.provider = this.options.fallback.provider;
    return this.options.fallback.hover?.(input, options);
  }

  public capability(): CodeNavigationCapability {
    return (
      this.options.primary.capability?.() ?? {
        status: "available",
        provider: this.options.primary.provider,
        reason: "language_server_attached",
        operations: CODE_NAVIGATION_OPERATIONS,
      }
    );
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.documentSymbols?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.documentSymbols?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.workspaceSymbols?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.workspaceSymbols?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async implementation(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.implementation?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.implementation?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.callHierarchy?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.callHierarchy?.(input, options) ??
        Promise.resolve([]),
    );
  }

  private async firstNonEmpty(
    primary: () => Promise<readonly CodeNavigationLocation[]>,
    fallback: () => Promise<readonly CodeNavigationLocation[]>,
  ): Promise<readonly CodeNavigationLocation[]> {
    try {
      const locations = await primary();
      if (locations.length > 0) {
        this.provider = this.options.primary.provider;
        return locations;
      }
    } catch {
      // Language servers can fail closed; graph remains available.
    }
    this.provider = this.options.fallback.provider;
    return fallback();
  }
}
