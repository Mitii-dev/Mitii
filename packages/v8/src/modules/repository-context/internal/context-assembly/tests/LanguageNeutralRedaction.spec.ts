import assert from "node:assert/strict";
import test from "node:test";

import { ContextSecretRedactor } from "../ContextSecretRedactor";

test("secret redaction is language-neutral across comment and assignment forms", () => {
  const redactor = new ContextSecretRedactor();

  const samples = [
    'const api_key = "baseline-secret-value-123456";',
    'api_key = "baseline-secret-value-123456"',
    'API_KEY=baseline-secret-value-123456',
    '// password: baseline-secret-value-123456',
    '-- password = baseline-secret-value-123456',
  ];

  for (const sample of samples) {
    const result = redactor.redact(sample);
    assert.ok(result.redactions.length > 0, `expected redaction for: ${sample}`);
    assert.equal(result.content.includes("baseline-secret-value-123456"), false);
  }
});
