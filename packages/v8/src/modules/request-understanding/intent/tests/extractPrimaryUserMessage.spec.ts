import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPrimaryUserMessage,
  MITII_HOST_CONTEXT_MARKER,
  MITII_USER_MESSAGE_MARKER,
} from "../extractPrimaryUserMessage";

test("extractPrimaryUserMessage reads marked user ask", () => {
  const message = [
    `${MITII_USER_MESSAGE_MARKER}`,
    "List all test cases and how to run them",
    "",
    `${MITII_HOST_CONTEXT_MARKER}`,
    "Workspace file map (120 files):",
    "- package.json",
  ].join("\n");

  assert.equal(
    extractPrimaryUserMessage(message),
    "List all test cases and how to run them",
  );
});

test("extractPrimaryUserMessage recovers legacy host-first prompts", () => {
  const message = [
    "Workspace file map (2 files):",
    "- a.ts",
    "- b.ts",
    "",
    "Git status: clean",
    "",
    "Can you list down all the test cases in this project",
  ].join("\n");

  assert.equal(
    extractPrimaryUserMessage(message),
    "Can you list down all the test cases in this project",
  );
});

test("extractPrimaryUserMessage leaves plain asks unchanged", () => {
  assert.equal(
    extractPrimaryUserMessage("explain this project"),
    "explain this project",
  );
});
