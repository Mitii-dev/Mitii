export interface EstablishedFact {
  id: string;
  content: string;
  /** Optional structured kind for working-set / reinject formatting. */
  kind?:
    | "observation"
    | "compiler_queue"
    | "package_template"
    | "package_target"
    | "path_summary";
  /** Optional normalized paths this fact refers to. */
  paths?: readonly string[];
}

export interface CompilerErrorItem {
  path: string;
  line: string;
  code: string;
  message: string;
}
