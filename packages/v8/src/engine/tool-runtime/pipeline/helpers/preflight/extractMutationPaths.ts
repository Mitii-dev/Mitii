import { normalizeApplyPatchArguments } from "../../../internal/normalizeApplyPatchArguments";

export function extractMutationPaths(
  toolName: string,
  argumentsValue: unknown,
): string[] {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const args = argumentsValue as Record<string, unknown>;

  if (toolName === "apply_patch") {
    const normalized = normalizeApplyPatchArguments(argumentsValue);
    if (
      !normalized ||
      typeof normalized !== "object" ||
      !("patches" in normalized) ||
      !Array.isArray((normalized as { patches: unknown }).patches)
    ) {
      return [];
    }
    return ((normalized as { patches: Array<{ path?: unknown }> }).patches)
      .map((patch) => (typeof patch.path === "string" ? patch.path : undefined))
      .filter((path): path is string => typeof path === "string");
  }

  if (toolName === "delete_file" || toolName === "delete_directory") {
    return typeof args.path === "string" ? [args.path] : [];
  }

  if (toolName === "move_file") {
    const paths: string[] = [];
    if (typeof args.from === "string") {
      paths.push(args.from);
    }
    if (typeof args.to === "string") {
      paths.push(args.to);
    }
    return paths;
  }

  return [];
}
