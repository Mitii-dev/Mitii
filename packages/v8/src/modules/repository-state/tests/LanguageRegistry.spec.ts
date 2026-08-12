import assert from "node:assert/strict";
import test from "node:test";

import {
  LANGUAGE_IDS,
  defaultLanguageProfileRegistry,
  languageIdSchema,
  projectDescriptorSchema,
} from "../index";

test("language registry accepts every target language id plus unknown", () => {
  for (const id of LANGUAGE_IDS) {
    assert.equal(languageIdSchema.safeParse(id).success, true);
    assert.equal(defaultLanguageProfileRegistry.accepts(id), true);
    assert.equal(defaultLanguageProfileRegistry.get(id).id, id);
  }

  assert.equal(LANGUAGE_IDS.includes("unknown"), true);
  assert.equal(languageIdSchema.safeParse("brainfuck").success, false);
});

test("unknown-text fallback is used for extensionless config files", () => {
  const detection = defaultLanguageProfileRegistry.detectFromPath(
    "repo/.env.local",
  );

  assert.equal(detection.languageId, "unknown");
  assert.equal(detection.source, "fallback");
  assert.match(detection.evidence, /unknown-text/);
});

test("shell and python resolve from extension or shebang without core branching", () => {
  assert.equal(
    defaultLanguageProfileRegistry.detectFromPath("scripts/setup.sh").languageId,
    "shell",
  );
  assert.equal(
    defaultLanguageProfileRegistry.detectFromShebang("#!/usr/bin/env python3")
      ?.languageId,
    "python",
  );
});

test("extension index is the single source for target-language mappings", () => {
  const extensions = defaultLanguageProfileRegistry.extensionIndex();
  assert.equal(extensions[".ts"], "typescript");
  assert.equal(extensions[".py"], "python");
  assert.equal(extensions[".vue"], undefined);
});

test("project descriptor contract pins a primary language id", () => {
  const project = projectDescriptorSchema.parse({
    projectId: "app",
    rootPath: "packages/app",
    primaryLanguageId: "typescript",
    manifestPaths: ["packages/app/package.json"],
  });

  assert.equal(project.primaryLanguageId, "typescript");
});
