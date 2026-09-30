import type { CODE_NAVIGATION_OPERATIONS } from "../../constants";
import type {
  CodeNavigationDocumentQuery,
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from "../input/CodeNavigationInput";

/**
 * Architecture capability formula. Hosts report this; V8 does not spawn servers.
 * `available` = language service attached, `degraded` = graph-only, `unavailable` = none.
 */
export interface CodeNavigationCapability {
  status: "available" | "degraded" | "unavailable";
  provider: "language_server" | "repo_graph" | "none";
  reason: string;
  operations: readonly (typeof CODE_NAVIGATION_OPERATIONS)[number][];
}

/** Optional per-call controls (tool abort, turn cancel). */
export interface CodeNavigationCallOptions {
  signal?: AbortSignal;
}

/**
 * Host-injected navigation. VS Code uses language-server commands; CLI may
 * attach a host-owned language service or degrade to the repo graph.
 * V8 must not import `vscode` or spawn servers itself.
 */
export interface CodeNavigationPort {
  readonly id: string;
  readonly provider: "language_server" | "repo_graph";

  capability?(): CodeNavigationCapability;

  /**
   * Ensure the document is known to the language service before caret queries
   * (opencode touchFile / didOpen pattern). Optional — graph adapters no-op.
   */
  prepare?(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void>;

  definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  /**
   * Go to the type of the symbol at the caret (vscode type definition /
   * TypeScript getTypeDefinitionAtPosition).
   */
  typeDefinition?(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  hover?(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined>;

  documentSymbols?(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  workspaceSymbols?(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  implementation?(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;

  /**
   * Callers or callees of the symbol at the caret.
   * `direction` defaults to outgoing (callees).
   */
  callHierarchy?(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]>;
}
