import type {
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../input/CodeNavigationInput";

/**
 * Host-injected navigation. VS Code uses language-server commands; CLI may
 * use repo-graph only. V8 must not import `vscode` or spawn servers itself.
 */
export interface CodeNavigationPort {
  readonly id: string;
  readonly provider: "language_server" | "repo_graph";

  definition(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  references(
    input: CodeNavigationQuery,
  ): Promise<readonly CodeNavigationLocation[]>;

  hover?(
    input: CodeNavigationQuery,
  ): Promise<CodeNavigationHover | undefined>;
}
