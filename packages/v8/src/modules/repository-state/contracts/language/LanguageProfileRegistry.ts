import {
  LANGUAGE_IDS,
  languageIdSchema,
  languageProfileSchema,
  type LanguageDetectionEvidence,
  type LanguageId,
  type LanguageProfile,
} from "./LanguageContracts";

const PROFILES: readonly LanguageProfile[] = [
  languageProfileSchema.parse({
    id: "typescript",
    displayName: "TypeScript",
    extensions: [".ts", ".mts", ".cts", ".tsx"],
    aliases: ["ts", "tsx"],
    capability: "enhanced",
  }),
  languageProfileSchema.parse({
    id: "javascript",
    displayName: "JavaScript",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    aliases: ["js", "jsx", "node"],
    capability: "enhanced",
  }),
  languageProfileSchema.parse({
    id: "python",
    displayName: "Python",
    extensions: [".py", ".pyi", ".pyw"],
    filenames: ["requirements.txt"],
    shebangPatterns: ["python", "python3"],
    aliases: ["py"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "java",
    displayName: "Java",
    extensions: [".java"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "csharp",
    displayName: "C#",
    extensions: [".cs"],
    aliases: ["c#", "cs"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "go",
    displayName: "Go",
    extensions: [".go"],
    filenames: ["go.mod", "go.sum"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "rust",
    displayName: "Rust",
    extensions: [".rs"],
    filenames: ["Cargo.toml"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "c",
    displayName: "C",
    extensions: [".c", ".h"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "cpp",
    displayName: "C++",
    extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hxx"],
    aliases: ["c++", "cplusplus"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "ruby",
    displayName: "Ruby",
    extensions: [".rb"],
    filenames: ["Gemfile"],
    shebangPatterns: ["ruby"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "php",
    displayName: "PHP",
    extensions: [".php"],
    filenames: ["composer.json"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "kotlin",
    displayName: "Kotlin",
    extensions: [".kt", ".kts"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "swift",
    displayName: "Swift",
    extensions: [".swift"],
    filenames: ["Package.swift"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "shell",
    displayName: "Shell",
    extensions: [".sh", ".bash", ".zsh"],
    shebangPatterns: ["bash", "sh", "zsh"],
    aliases: ["bash", "zsh", "sh"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "sql",
    displayName: "SQL",
    extensions: [".sql"],
    capability: "baseline",
  }),
  languageProfileSchema.parse({
    id: "unknown",
    displayName: "Unknown text",
    extensions: [],
    aliases: ["text", "plain", "config"],
    capability: "baseline",
  }),
];

/**
 * Registry of normalized language profiles for Repository State.
 * Core pipelines select adapters by LanguageId; they do not branch on raw extensions.
 */
export class LanguageProfileRegistry {
  private readonly byId = new Map<LanguageId, LanguageProfile>();
  private readonly byAlias = new Map<string, LanguageId>();
  private readonly byExtension = new Map<string, LanguageId>();
  private readonly byFilename = new Map<string, LanguageId>();

  constructor(profiles: readonly LanguageProfile[] = PROFILES) {
    for (const profile of profiles) {
      this.byId.set(profile.id, profile);
      this.byAlias.set(profile.id.toLowerCase(), profile.id);
      for (const alias of profile.aliases) {
        this.byAlias.set(alias.toLowerCase(), profile.id);
      }
      for (const extension of profile.extensions) {
        this.byExtension.set(extension.toLowerCase(), profile.id);
      }
      for (const filename of profile.filenames) {
        this.byFilename.set(filename.toLowerCase(), profile.id);
      }
    }

    for (const id of LANGUAGE_IDS) {
      if (!this.byId.has(id)) {
        throw new Error(`LanguageProfileRegistry missing required id: ${id}`);
      }
    }
  }

  public list(): readonly LanguageProfile[] {
    return [...this.byId.values()];
  }

  public get(id: LanguageId): LanguageProfile {
    const profile = this.byId.get(languageIdSchema.parse(id));
    if (!profile) {
      throw new Error(`Unknown language id: ${id}`);
    }
    return profile;
  }

  public accepts(id: string): id is LanguageId {
    return languageIdSchema.safeParse(id).success;
  }

  public resolveAlias(value: string): LanguageId | undefined {
    return this.byAlias.get(value.trim().toLowerCase());
  }

  public extensionIndex(): Readonly<Record<string, LanguageId>> {
    return Object.fromEntries(this.byExtension);
  }

  public filenameIndex(): Readonly<Record<string, LanguageId>> {
    return Object.fromEntries(this.byFilename);
  }

  public detectFromPath(pathOrName: string): LanguageDetectionEvidence {
    const normalized = pathOrName.replace(/\\/g, "/");
    const basename = (normalized.split("/").pop() ?? "").toLowerCase();

    const byFilename = this.byFilename.get(basename);
    if (byFilename) {
      return {
        languageId: byFilename,
        source: "filename",
        evidence: `filename:${basename}`,
      };
    }

    const extensionIndex = basename.lastIndexOf(".");
    if (extensionIndex > 0) {
      const extension = basename.slice(extensionIndex).toLowerCase();
      const byExtension = this.byExtension.get(extension);
      if (byExtension) {
        return {
          languageId: byExtension,
          source: "extension",
          evidence: `extension:${extension}`,
        };
      }
    }

    return {
      languageId: "unknown",
      source: "fallback",
      evidence: `unknown-text:${basename || pathOrName}`,
    };
  }

  public detectFromShebang(firstLine: string): LanguageDetectionEvidence | undefined {
    if (!firstLine.startsWith("#!")) {
      return undefined;
    }

    const lower = firstLine.toLowerCase();
    for (const profile of this.byId.values()) {
      for (const pattern of profile.shebangPatterns) {
        if (lower.includes(pattern.toLowerCase())) {
          return {
            languageId: profile.id,
            source: "shebang",
            evidence: `shebang:${pattern}`,
          };
        }
      }
    }

    return undefined;
  }
}

export const defaultLanguageProfileRegistry = new LanguageProfileRegistry();
