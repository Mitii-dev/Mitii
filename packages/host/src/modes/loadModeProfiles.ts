import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  BUILTIN_MODE_PROFILES,
  getBuiltinModeProfile,
} from "./builtinModeProfiles.js";
import {
  MODE_PROFILE_SCHEMA_VERSION,
  modeCatalogSchema,
  modeProfileSchema,
  type ModeCatalog,
  type ModeProfile,
} from "./modeProfileSchema.js";

export const MODE_CATALOG_FILENAME = "modes.json";

export interface LoadModeProfilesResult {
  /** Merged catalog (builtins + project overlays). */
  profiles: readonly ModeProfile[];
  /** Active slug from project catalog, if any. */
  activeSlug?: string;
  /** Resolved active profile when activeSlug is set and found. */
  active?: ModeProfile;
}

/**
 * Load `.mitii/modes.json` and merge with built-in profiles.
 * Project modes override builtins on matching slug. Invalid files → builtins only.
 */
export function loadModeProfiles(
  workspaceRoot: string,
): LoadModeProfilesResult {
  const bySlug = new Map<string, ModeProfile>();
  for (const profile of BUILTIN_MODE_PROFILES) {
    bySlug.set(profile.slug, profile);
  }

  let activeSlug: string | undefined;
  const path = join(workspaceRoot, ".mitii", MODE_CATALOG_FILENAME);
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const parsed = modeCatalogSchema.safeParse(raw);
      if (parsed.success) {
        activeSlug = parsed.data.active;
        for (const mode of parsed.data.modes) {
          bySlug.set(mode.slug, { ...mode, source: "project" });
        }
      }
    } catch {
      // Soft-fail: keep builtins.
    }
  }

  const profiles = [...bySlug.values()];
  const active = activeSlug
    ? profiles.find((profile) => profile.slug === activeSlug)
    : undefined;

  return {
    profiles,
    ...(activeSlug ? { activeSlug } : {}),
    ...(active ? { active } : {}),
  };
}

/**
 * Resolve a profile by slug (project catalog, then builtin).
 */
export function resolveModeProfile(
  workspaceRoot: string,
  slug: string,
): ModeProfile | undefined {
  const loaded = loadModeProfiles(workspaceRoot);
  return (
    loaded.profiles.find((profile) => profile.slug === slug) ??
    getBuiltinModeProfile(slug)
  );
}

/** Example `.mitii/modes.json` for scaffolding. */
export const MODE_CATALOG_EXAMPLE: ModeCatalog = {
  schemaVersion: 1,
  active: "code",
  modes: [
    {
      slug: "docs-only",
      name: "Docs only",
      agentMode: "agent",
      toolGroups: ["read", "edit"],
      mutationRelativePathRegex: "\\.(md|mdx)$",
      roleDefinition:
        "You only edit documentation files. Prefer clarity and accurate cross-links.",
      source: "project",
    },
  ],
};

export function parseModeProfile(raw: unknown): ModeProfile | undefined {
  const parsed = modeProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Set (or clear) the active mode profile slug in `.mitii/modes.json`.
 * Creates the file from MODE_CATALOG_EXAMPLE when missing.
 */
export function setActiveModeProfile(
  workspaceRoot: string,
  slug: string | undefined,
): { path: string; catalog: ModeCatalog } {
  const path = join(workspaceRoot, ".mitii", MODE_CATALOG_FILENAME);
  let catalog: ModeCatalog = {
    schemaVersion: MODE_PROFILE_SCHEMA_VERSION,
    modes: [],
  };

  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const parsed = modeCatalogSchema.safeParse(raw);
      if (parsed.success) catalog = parsed.data;
    } catch {
      // replace with empty catalog
    }
  }

  if (slug !== undefined) {
    const resolved =
      catalog.modes.find((m) => m.slug === slug) ?? getBuiltinModeProfile(slug);
    if (!resolved) {
      throw new Error(
        `Unknown mode profile "${slug}". Run: mitii profile list`,
      );
    }
    catalog = { ...catalog, active: slug };
  } else {
    catalog = {
      schemaVersion: MODE_PROFILE_SCHEMA_VERSION,
      modes: catalog.modes,
    };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return { path, catalog };
}

/** Write a starter `.mitii/modes.json` if absent. */
export function initModeCatalog(workspaceRoot: string): {
  path: string;
  created: boolean;
} {
  const path = join(workspaceRoot, ".mitii", MODE_CATALOG_FILENAME);
  if (existsSync(path)) return { path, created: false };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(MODE_CATALOG_EXAMPLE, null, 2)}\n`,
    "utf8",
  );
  return { path, created: true };
}
