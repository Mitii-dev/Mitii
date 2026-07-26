import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';
import { DuplicateContributionError, FeatureRegistry, RegistryFrozenError } from '../../src/kernel/registries';
import type { FeatureModule } from '../../src/interfaces/feature';
import { allEnterpriseFeatures } from '../../src/composition/ee/featureManifest';
import { ceFeatures } from '../../src/composition/ce/featureManifest';

const repoRoot = process.cwd();

describe('target architecture boundaries', () => {
  it('has no src/core or src/legacy-core quarantine left', () => {
    expect(existsSync(join(repoRoot, 'src/core'))).toBe(false);
    expect(existsSync(join(repoRoot, 'src/legacy-core'))).toBe(false);
  });

  it('keeps interface contracts free of implementation imports', () => {
    const violations = scanImports(join(repoRoot, 'src/interfaces'), [
      /from ['"].*(?:^|\/)(?:core|kernel|features|adapters|composition|ee|vscode|webview-ui)(?:\/|['"])/,
      /from ['"](?:\.\.\/)+(?:core|kernel|features|adapters|composition|ee|vscode|webview-ui)(?:\/|['"])/,
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps kernel free of host, edition, and legacy core imports', () => {
    const violations = scanImports(join(repoRoot, 'src/kernel'), [
      /from ['"].*(?:^|\/)(?:core|features|adapters|composition|ee|vscode|webview-ui)(?:\/|['"])/,
      /from ['"](?:\.\.\/)+(?:core|features|adapters|composition|ee|vscode|webview-ui)(?:\/|['"])/,
      /from ['"]vscode['"]/,
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps CE composition isolated from EE', () => {
    const violations = scanImports(join(repoRoot, 'src/composition/ce'), [
      /from ['"].*(?:^|\/)ee(?:\/|['"])/,
      /from ['"](?:\.\.\/)+ee(?:\/|['"])/,
    ]);

    expect(violations).toEqual([]);
  });

  it('keeps feature manifests uniquely identifiable', () => {
    const ids = allEnterpriseFeatures.map((feature) => feature.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allEnterpriseFeatures.length).toBeGreaterThanOrEqual(ceFeatures.length);
  });
});

describe('kernel registries', () => {
  it('reject duplicate feature ids before activation', () => {
    const registry = new FeatureRegistry();
    registry.register(testFeature('ce.test.alpha'));

    expect(() => registry.register(testFeature('ce.test.alpha'))).toThrow(DuplicateContributionError);
  });

  it('orders required feature dependencies before dependents', () => {
    const registry = new FeatureRegistry();
    registry.register(testFeature('ce.test.app', ['ce.test.base']));
    registry.register(testFeature('ce.test.base'));

    expect(registry.resolveActivationOrder().map((feature) => feature.manifest.id)).toEqual([
      'ce.test.base',
      'ce.test.app',
    ]);
  });

  it('freezes registries after bootstrap', () => {
    const registry = new FeatureRegistry();
    registry.freeze();

    expect(() => registry.register(testFeature('ce.test.late'))).toThrow(RegistryFrozenError);
  });
});

function testFeature(id: string, requires: readonly string[] = []): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ce',
      version: '1.0.0',
      requires,
    },
    register() {},
  };
}

function scanImports(root: string, patterns: readonly RegExp[]): string[] {
  if (!existsSync(root)) return [];

  return listTypeScriptFiles(root).flatMap((file) => {
    const content = readFileSync(file, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
      .map(({ line, index }) => `${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
  });
}

function listTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const stats = statSync(abs);
      if (stats.isDirectory()) {
        walk(abs);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        files.push(abs);
      }
    }
  };
  walk(root);
  return files;
}
