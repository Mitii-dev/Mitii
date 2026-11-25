import type { RepoGraph } from "../../repository-state";
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
import { graphCallHierarchy } from "./graph/call-hierarchy";
import { graphCapability } from "./graph/capability";
import { graphDefinition } from "./graph/definition";
import { graphDocumentSymbols } from "./graph/document-symbols";
import { graphHover } from "./graph/hover";
import { graphImplementation } from "./graph/implementation";
import { graphReferences } from "./graph/references";
import { graphTypeDefinition } from "./graph/type-definition";
import { graphWorkspaceSymbols } from "./graph/workspace-symbols";

export interface GraphCodeNavigationAdapterOptions {
  loadGraphs: () =>
    | readonly RepoGraph[]
    | Promise<readonly RepoGraph[]>;
}

/**
 * Repo-graph `CodeNavigationPort`. Method bodies: flat `impl/graph-*.ts` (same style as `flow/`).
 */
export class GraphCodeNavigationAdapter implements CodeNavigationPort {
  public readonly id = "repo-graph-code-navigation";
  public readonly provider = "repo_graph" as const;

  constructor(
    private readonly options: GraphCodeNavigationAdapterOptions,
  ) {}

  public capability(): CodeNavigationCapability {
    return graphCapability();
  }

  public async definition(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphDefinition(this.options.loadGraphs, input);
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphTypeDefinition(this.options.loadGraphs, input);
  }

  public async references(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphReferences(this.options.loadGraphs, input);
  }

  public async hover(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    return graphHover(this.options.loadGraphs, input);
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphDocumentSymbols(this.options.loadGraphs, input);
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphWorkspaceSymbols(this.options.loadGraphs, input);
  }

  public async implementation(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphImplementation(this.options.loadGraphs, input);
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return graphCallHierarchy(this.options.loadGraphs, input);
  }
}
