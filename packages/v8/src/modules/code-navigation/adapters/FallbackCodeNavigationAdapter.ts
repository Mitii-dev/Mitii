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
import { fallbackCallHierarchy } from "./fallback/call-hierarchy";
import { fallbackCapability } from "./fallback/capability";
import { fallbackDefinition } from "./fallback/definition";
import { fallbackDocumentSymbols } from "./fallback/document-symbols";
import { fallbackHover } from "./fallback/hover";
import { fallbackImplementation } from "./fallback/implementation";
import { fallbackPrepare } from "./fallback/prepare";
import { fallbackReferences } from "./fallback/references";
import { fallbackTypeDefinition } from "./fallback/type-definition";
import { fallbackWorkspaceSymbols } from "./fallback/workspace-symbols";

/**
 * Tries the primary language-service port, then a degraded graph port.
 * Method bodies: flat `impl/fallback-*.ts` (same style as `flow/`).
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

  public capability(): CodeNavigationCapability {
    return fallbackCapability(this.options.primary);
  }

  public async prepare(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void> {
    return fallbackPrepare({
      primary: this.options.primary,
      fallback: this.options.fallback,
      relativePath,
      options,
    });
  }

  public async definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackDefinition({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackTypeDefinition({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackReferences({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async hover(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    return fallbackHover({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackDocumentSymbols({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackWorkspaceSymbols({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async implementation(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackImplementation({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return fallbackCallHierarchy({
      primary: this.options.primary,
      fallback: this.options.fallback,
      sink: this,
      input,
      options,
    });
  }
}
