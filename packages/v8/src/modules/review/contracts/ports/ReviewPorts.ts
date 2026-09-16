import type { ReviewChangedFile } from "../input/ReviewInput";

/**
 * Host-injected git/diff provider. V8 never shells out itself.
 */
export interface ReviewDiffPort {
  listChangedFiles(input: {
    mode: "workspace" | "range" | "commit" | "scan";
    workspaceRoot: string;
    fromRef?: string;
    toRef?: string;
    commit?: string;
    paths?: readonly string[];
  }): Promise<readonly ReviewChangedFile[]>;
}

/**
 * Optional LLM helpers for relocate / reflect / grouping.
 * Omitting keeps finalize deterministic.
 */
export interface ReviewLlmPort {
  complete?(input: {
    purpose: "relocate" | "reflect" | "group";
    prompt: string;
    maxTokens?: number;
  }): Promise<string>;
}
