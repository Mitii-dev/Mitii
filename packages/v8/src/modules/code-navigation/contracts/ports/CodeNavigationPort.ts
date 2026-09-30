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
  prepare?(relativePath: string): Promise<void>;

  definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  /**
   * Go to the type of the symbol at the caret (vscode type definition /
   * TypeScript getTypeDefinitionAtPosition).
   */
  typeDefinition?(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  hover?(
    input: CodeNavigationQuery,
  ): Promise<CodeNavigationHover | undefined>;

  documentSymbols?(
    input: CodeNavigationDocumentQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  workspaceSymbols?(
    input: CodeNavigationWorkspaceQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  implementation?(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  /**
   * Callers or callees of the symbol at the caret.
   * `direction` defaults to outgoing (callees).
   */
  callHierarchy?(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;
}
