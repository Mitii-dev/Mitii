import type {
  ToolInvocationInput,
  ToolResult,
} from "../../../tool-runtime";

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
