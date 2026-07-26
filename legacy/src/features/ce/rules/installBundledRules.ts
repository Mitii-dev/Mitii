import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('BundledRules');

export interface InstallBundledRulesResult {
  installed: string[];
  skipped: string[];
  bundledRoot: string;
  destinationRoot: string;
}

function resolveBundledRulesRoot(extensionRoot: string): string | undefined {
  const candidates = [
    join(extensionRoot, 'dist', 'features', 'ce', 'rules', 'bundled'),
    join(extensionRoot, 'src', 'features', 'ce', 'rules', 'bundled'),
    join(extensionRoot, 'dist', 'core', 'rules', 'bundled'),
    join(extensionRoot, 'src', 'core', 'rules', 'bundled'),
    join(extensionRoot, 'core', 'rules', 'bundled'),
  ];
  return candidates.find((path) => existsSync(path));
}

/** Copy extension-bundled rules into `.mitii/rules` (idempotent). */
export function installBundledRules(
  workspace: string,
  extensionRoot: string,
  options: { force?: boolean } = {}
): InstallBundledRulesResult {
  const bundledRoot = resolveBundledRulesRoot(extensionRoot);
  const destinationRoot = join(workspace, '.mitii', 'rules');
  const installed: string[] = [];
  const skipped: string[] = [];

  if (!bundledRoot || !existsSync(bundledRoot)) {
    log.warn('Bundled rules directory missing', { extensionRoot });
    return { installed, skipped, bundledRoot: bundledRoot ?? '', destinationRoot };
  }

  mkdirSync(destinationRoot, { recursive: true });

  const source = join(bundledRoot, 'path-resolution.md');
  const target = join(destinationRoot, 'path-resolution.md');
  if (!existsSync(source)) {
    log.warn('Bundled path-resolution rule missing', { source });
    return { installed, skipped, bundledRoot, destinationRoot };
  }

  if (existsSync(target) && !options.force) {
    skipped.push('path-resolution.md');
  } else {
    cpSync(source, target);
    installed.push('path-resolution.md');
  }

  if (installed.length > 0 || skipped.length > 0) {
    log.info('Bundled rules install finished', {
      installed: installed.length,
      skipped: skipped.length,
      destinationRoot,
    });
  }

  return { installed, skipped, bundledRoot, destinationRoot };
}
