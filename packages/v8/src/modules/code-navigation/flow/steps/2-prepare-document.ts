import type {
  CodeNavigationCallOptions,
  CodeNavigationParsedInput,
  CodeNavigationPort,
} from "../../contracts";

/**
 * Flow step 2: optional host prepare for the target relative path.
 */
export async function prepareCodeNavigationDocument(params: {
  port: CodeNavigationPort;
  input: CodeNavigationParsedInput;
  options: CodeNavigationCallOptions;
}): Promise<void> {
  const relativePath =
    "relativePath" in params.input.query
      ? params.input.query.relativePath
      : undefined;
  if (!relativePath) {
    return;
  }
  await params.port.prepare?.(relativePath, params.options);
}
