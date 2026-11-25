import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCurrentUserRequestForAnalysis,
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

test("extractCurrentUserRequestForAnalysis ignores prior-turn file paths", () => {
  const amended = [
    "Prior conversation (for intent routing only; not the live user request):",
    "user: SyntaxError in apps/docs",
    "assistant: Check apps/docs/src/components/live-demo-mui.tsx",
    "",
    "Current user request:",
    "check in @packages and fix it",
  ].join("\n");

  assert.equal(
    extractCurrentUserRequestForAnalysis(amended),
    "check in @packages and fix it",
  );
});
