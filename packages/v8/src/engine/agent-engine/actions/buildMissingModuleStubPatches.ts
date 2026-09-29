import type { VerificationDiagnostic } from "../../../modules/verification";

export interface MissingModuleStubPatch {
  path: string;
  oldText: string;
  newText: string;
}

const CANNOT_FIND_MODULE =
  /Cannot find module ['"]([^'"]+)['"]/i;

/**
 * Turn preflight TS2307 (cannot find module) diagnostics into create-file
 * apply_patch hunks (empty oldText). Used when mutation lock is active and the
 * model keeps rediscovering instead of creating the missing file.
 */
export function buildMissingModuleStubPatches(params: {
  diagnostics: readonly VerificationDiagnostic[];
  pathScopes?: readonly string[];
  maxPatches?: number;
}): MissingModuleStubPatch[] {
  const max = Math.max(1, Math.floor(params.maxPatches ?? 8));
  const scopes = params.pathScopes ?? ["."];
  const out: MissingModuleStubPatch[] = [];
  const seen = new Set<string>();

  for (const diagnostic of params.diagnostics) {
    if (out.length >= max) break;
    if (diagnostic.severity !== "error") continue;
    if (!isPathInScopes(diagnostic.path, scopes)) continue;

    const match = CANNOT_FIND_MODULE.exec(diagnostic.message);
    if (!match) continue;
    const specifier = match[1]?.trim();
    if (!specifier || !specifier.startsWith(".")) continue;

    const resolved = resolveRelativeModulePath(diagnostic.path, specifier);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);

    out.push({
      path: resolved,
      oldText: "",
      newText: stubModuleSource(resolved),
    });
  }

  return out;
}

function resolveRelativeModulePath(
  fromFile: string,
  specifier: string,
): string | undefined {
  const fromDir = fromFile.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  const parts = [...fromDir.split("/").filter(Boolean)];
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  let path = parts.join("/");
  // Only treat known source extensions as final; names like Header.selectors
  // must still get a .ts suffix.
  if (!/\.(tsx?|jsx?|mjs|cjs|json|d\.ts)$/i.test(path)) {
    path = `${path}.ts`;
  }
  return path;
}

function stubModuleSource(path: string): string {
  const base =
    path
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "") ?? "Stub";
  const className = toPascalCase(base.replace(/\.selectors$/i, "Selectors"));
  return [
    `/** Auto-created stub for missing module (${path}). */`,
    `export default class ${className} {`,
    `  constructor(_driver?: unknown) {}`,
    `}`,
    "",
  ].join("\n");
}

function toPascalCase(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "StubModule";
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function isPathInScopes(path: string, scopes: readonly string[]): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedScopes = scopes.map(normalizePath).filter(Boolean);
  if (normalizedScopes.length === 0) return true;
  return normalizedScopes.some((scope) => {
    if (scope === ".") return true;
    return normalizedPath === scope || normalizedPath.startsWith(`${scope}/`);
  });
}

function normalizePath(value: string): string {
  return (
    value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^@+/, "")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "") || "."
  );
}
