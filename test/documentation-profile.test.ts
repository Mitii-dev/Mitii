import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverDocumentationSites, suggestDocsVerifyCommands, buildDocumentationContextHints } from '../src/features/ce/skills/documentationProfile';
import { extractTaskFeatures, askIntentFromFeatures } from '../src/features/ce/pipeline/classify/taskFeatures';

describe('documentationProfile', () => {
  it('discovers docusaurus docs packages and verify commands from package scripts', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-docs-profile-'));
    try {
      const docsRoot = join(workspace, 'apps', 'docs');
      mkdirSync(docsRoot, { recursive: true });
      writeFileSync(
        join(docsRoot, 'package.json'),
        JSON.stringify({
          name: '@acme/docs',
          scripts: { build: 'docusaurus build', test: 'echo noop' },
          devDependencies: { '@docusaurus/core': '3.0.0' },
        })
      );
      writeFileSync(join(docsRoot, 'docusaurus.config.ts'), 'export default {};\n');

      const sites = discoverDocumentationSites(workspace);
      expect(sites.some((site) => site.packageRoot === 'apps/docs')).toBe(true);
      expect(suggestDocsVerifyCommands(workspace).some((cmd) => cmd.includes('apps/docs') && cmd.includes('build'))).toBe(true);
      expect(buildDocumentationContextHints(workspace)).toContain('apps/docs/docusaurus.config.ts');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('taskFeatures', () => {
  it('separates question phrasing from action intent', () => {
    const features = extractTaskFeatures('How do I add authentication?', 'answer');
    expect(features.isQuestion).toBe(true);
    expect(features.hasActionVerbs).toBe(true);
    expect(askIntentFromFeatures(features)).not.toBe('general_knowledge');
  });

  it('detects mdx repair and docs mentions once', () => {
    const text = 'MDX compilation failed for file "docs/guide.mdx" in docusaurus build';
    const features = extractTaskFeatures(text, 'execute');
    expect(features.isMdxRepair).toBe(true);
    expect(features.isDocsMention).toBe(true);
  });
});
