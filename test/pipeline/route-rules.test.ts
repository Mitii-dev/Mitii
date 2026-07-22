import { describe, expect, it } from 'vitest';
import { resolveAuditSubtype, resolveDocsSubtype } from '../../src/features/ce/pipeline/index';

describe('auditRules registry — one representative phrase per rule', () => {
  const cases: Array<{ id: string; text: string; subtype: string }> = [
    { id: 'log-audit', text: 'Run a log audit over the session .jsonl files', subtype: 'log' },
    { id: 'unused-deps', text: 'Find unused dependencies with depcheck', subtype: 'unused_deps' },
    { id: 'dead-code', text: 'Scan for dead code and orphan exports with knip', subtype: 'dead_code' },
    { id: 'vulnerability', text: 'Run npm audit to find CVEs in our dependencies', subtype: 'vulnerability' },
    { id: 'prompt-audit', text: 'Do a prompt audit on our system prompts', subtype: 'prompt' },
    { id: 'security-config', text: 'Review our security config, CORS and CSP settings', subtype: 'security_config' },
    { id: 'git-history-audit', text: 'Do a git history audit on this file', subtype: 'git_history' },
    { id: 'ci-audit', text: 'Do a CI audit of our GitHub Actions workflows', subtype: 'ci' },
    { id: 'database-audit', text: 'Do a database audit of our schema', subtype: 'database' },
    { id: 'architecture-audit', text: 'Do an architecture audit of this service', subtype: 'architecture' },
    { id: 'code-quality-audit', text: 'Do a code quality audit and flag tech debt', subtype: 'code_quality' },
    { id: 'generic-cleanup', text: 'Please clean up unused files in this repo', subtype: 'generic' },
    { id: 'bare-audit-review', text: 'Audit our API authorization and fix the findings', subtype: 'review' },
  ];

  it.each(cases)('$id → $subtype', ({ text, subtype }) => {
    expect(resolveAuditSubtype(text)).toBe(subtype);
  });
});

describe('docsRules registry — one representative phrase per rule', () => {
  const cases: Array<{ id: string; text: string; subtype: string }> = [
    { id: 'mdx-repair', text: 'Fix this MDX compilation error in the docs build', subtype: 'mdx_repair' },
    { id: 'docusaurus', text: 'Update the docusaurus sidebar config', subtype: 'docusaurus' },
    { id: 'readme', text: 'Update the README with the new setup steps', subtype: 'readme' },
    { id: 'api-reference', text: 'Generate the API reference docs from our OpenAPI spec', subtype: 'api_reference' },
    { id: 'architecture-docs', text: 'Write the architecture doc for this service', subtype: 'architecture' },
    { id: 'changelog-docs', text: 'Update the changelog for this release', subtype: 'changelog' },
    { id: 'examples-docs', text: 'Add usage examples docs for the new API', subtype: 'examples' },
    { id: 'generic-docs', text: 'Improve the documentation for this module', subtype: 'generic' },
  ];

  it.each(cases)('$id → $subtype', ({ text, subtype }) => {
    expect(resolveDocsSubtype(text)).toBe(subtype);
  });
});
