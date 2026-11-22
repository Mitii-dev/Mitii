import type {
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from '@mitii/v8';
import { CODE_NAVIGATION_OPERATIONS } from '@mitii/v8';

type CodeNavigationCallOptions = { signal?: AbortSignal };

/**
 * Prefer stdio language servers when they return locations; fall back to the
 * in-process TypeScript service for TS/JS (and always for diagnostics).
 */
export class PreferStdioThenTypeScriptPort implements CodeNavigationPort {
  public readonly id = 'stdio-then-typescript';
  public readonly provider = 'language_server' as const;

  constructor(
    private readonly stdio: CodeNavigationPort,
    private readonly typescript: CodeNavigationPort,
  ) {}

  public capability(): CodeNavigationCapability {
    return (
      this.stdio.capability?.() ??
      this.typescript.capability?.() ?? {
        status: 'available',
        provider: 'language_server',
        reason: 'language_server_attached',
        operations: CODE_NAVIGATION_OPERATIONS,
      }
    );
  }

  public async prepare(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void> {
    try {
      await this.stdio.prepare?.(relativePath, options);
    } catch {
      // Stdio prepare failure must not block in-process TypeScript.
    }
    if (isTypeScriptPath(relativePath)) {
      await this.typescript.prepare?.(relativePath, options);
    }
  }

  public async definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.definition(input, options),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.definition(input, options);
    }
    return [];
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.typeDefinition?.(input, options) ?? Promise.resolve([]),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.typeDefinition?.(input, options) ?? [];
    }
    return [];
  }

  public async references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.references(input, options),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.references(input, options);
    }
    return [];
  }

  public async hover(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    try {
      const fromStdio = await this.stdio.hover?.(input, options);
      if (fromStdio) return fromStdio;
    } catch {
      // Fall through to in-process TypeScript.
    }
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.hover?.(input, options);
    }
    return undefined;
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.documentSymbols?.(input, options) ?? Promise.resolve([]),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.documentSymbols?.(input, options) ?? [];
    }
    return [];
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.workspaceSymbols?.(input, options) ?? Promise.resolve([]),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    return this.typescript.workspaceSymbols?.(input, options) ?? [];
  }

  public async implementation(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.implementation?.(input, options) ?? Promise.resolve([]),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.implementation?.(input, options) ?? [];
    }
    return [];
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ) {
    const fromStdio = await this.tryStdio(() =>
      this.stdio.callHierarchy?.(input, options) ?? Promise.resolve([]),
    );
    if (fromStdio && fromStdio.length > 0) return fromStdio;
    if (isTypeScriptPath(input.relativePath)) {
      return this.typescript.callHierarchy?.(input, options) ?? [];
    }
    return [];
  }

  private async tryStdio(
    run: () => Promise<readonly CodeNavigationLocation[]>,
  ): Promise<readonly CodeNavigationLocation[] | undefined> {
    try {
      return await run();
    } catch {
      return undefined;
    }
  }
}

export function isTypeScriptPath(relativePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(relativePath);
}
