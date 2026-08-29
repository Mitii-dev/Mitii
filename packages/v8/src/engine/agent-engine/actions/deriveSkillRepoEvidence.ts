import type { ProjectDescriptor } from "../../../modules/repository-state";

export interface SkillRepoEvidence {
  languages: string[];
  projectKinds: string[];
}

/**
 * Derive soft skill-matching language / project-kind tags from host projects
 * and discovered paths. Never sole authority for skill selection.
 */
export function deriveSkillRepoEvidence(params: {
  projects?: readonly ProjectDescriptor[];
  paths?: readonly string[];
}): SkillRepoEvidence {
  const languages = new Set<string>();
  const projectKinds = new Set<string>();

  for (const project of params.projects ?? []) {
    if (project.primaryLanguageId) {
      languages.add(project.primaryLanguageId);
      projectKinds.add(project.primaryLanguageId);
    }
    if (project.ecosystemId) {
      projectKinds.add(project.ecosystemId);
      for (const mapped of ecosystemToLanguages(project.ecosystemId)) {
        languages.add(mapped);
      }
    }
  }

  for (const language of inferLanguagesFromPaths(params.paths ?? [])) {
    languages.add(language);
    projectKinds.add(language);
  }

  return {
    languages: [...languages].slice(0, 20),
    projectKinds: [...projectKinds].slice(0, 20),
  };
}

function ecosystemToLanguages(ecosystemId: string): string[] {
  const id = ecosystemId.toLowerCase();
  if (
    id.includes("node") ||
    id.includes("npm") ||
    id.includes("pnpm") ||
    id.includes("yarn") ||
    id.includes("typescript") ||
    id.includes("javascript")
  ) {
    return ["typescript", "javascript"];
  }
  if (id.includes("python") || id.includes("pip") || id.includes("poetry")) {
    return ["python"];
  }
  if (id.includes("go") || id === "golang") {
    return ["go"];
  }
  if (id.includes("rust") || id.includes("cargo")) {
    return ["rust"];
  }
  if (id.includes("maven") || id.includes("gradle") || id.includes("java")) {
    return ["java"];
  }
  if (id.includes("dotnet") || id.includes("nuget") || id.includes("csharp")) {
    return ["csharp"];
  }
  if (id.includes("ruby") || id.includes("bundler")) {
    return ["ruby"];
  }
  if (id.includes("composer") || id.includes("php")) {
    return ["php"];
  }
  if (id.includes("swift") || id.includes("cocoapods") || id.includes("spm")) {
    return ["swift"];
  }
  return [];
}

function inferLanguagesFromPaths(paths: readonly string[]): string[] {
  const joined = paths.join(" ").toLowerCase();
  const found: string[] = [];
  const push = (id: string) => {
    if (!found.includes(id)) {
      found.push(id);
    }
  };
  if (/\.(ts|tsx)\b/.test(joined)) push("typescript");
  if (/\.(js|jsx|mjs|cjs)\b/.test(joined)) push("javascript");
  if (/\.py\b/.test(joined)) push("python");
  if (/\.go\b/.test(joined)) push("go");
  if (/\.rs\b/.test(joined)) push("rust");
  if (/\.java\b/.test(joined)) push("java");
  if (/\.kt\b/.test(joined)) push("kotlin");
  if (/\.cs\b/.test(joined)) push("csharp");
  if (/\.(c|h)\b/.test(joined)) push("c");
  if (/\.(cc|cpp|cxx|hpp)\b/.test(joined)) push("cpp");
  if (/\.rb\b/.test(joined)) push("ruby");
  if (/\.php\b/.test(joined)) push("php");
  if (/\.swift\b/.test(joined)) push("swift");
  if (/\.(sh|bash|zsh)\b/.test(joined)) push("shell");
  if (/\.sql\b/.test(joined)) push("sql");
  return found;
}
