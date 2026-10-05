import type {
  ToolInvocationInput,
  ToolResult,
} from "../../../../engine/tool-runtime";

/**
 * Thin port over Tool Runtime's public facade.
 * Verification MUST NOT spawn processes or touch the filesystem directly.
 */
export interface VerificationToolExecutorPort {
  execute(
    input: ToolInvocationInput,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult>;
}

/**
 * Reads trusted project metadata for check discovery.
 * Hosts typically back this with workspace FS; tests use in-memory maps.
 */
export interface VerificationManifestReaderPort {
  exists(relativePath: string): Promise<boolean>;
  readText(relativePath: string): Promise<string | null>;
}

/** One tree-sitter / host syntax finding (not a full typecheck diagnostic). */
export interface VerificationSyntaxFinding {
  path: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
}

/**
 * Optional host syntax gate (tree-sitter ERROR/missing nodes).
 * Prefer this over spawning `py_compile` / `node --check` when wired.
 * Does not satisfy typecheck evidence.
 */
export interface VerificationSyntaxPort {
  checkFiles(params: {
    workspaceRoot: string;
    paths: readonly string[];
    signal?: AbortSignal;
  }): Promise<{
    findings: readonly VerificationSyntaxFinding[];
    warnings?: readonly string[];
  }>;
}

/** Evidence source marker for port-backed syntax candidates. */
export const SYNTAX_PORT_EVIDENCE = "port:syntax";

/**
 * Evidence source for Node ESM/CJS module-load checks.
 * Catches duplicate exports and other instantiate-time errors that
 * `node --check` and tree-sitter parse miss.
 */
export const NODE_MODULE_LOAD_EVIDENCE = "changed-files:node_module_load";
