import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { MODE_CATALOG_FILENAME } from '@mitii/host';

export interface MitiiCliPaths {
  cwd: string;
  projectConfig: string;
  globalConfig: string;
  activeConfig: string | null;
  projectDotEnv: string;
  projectMitiiDotEnv: string;
  globalDotEnv: string;
  logsDir: string;
  logsDirSource: 'MITII_LOGS_PATH' | 'workspace';
  indexSqlite: string;
  indexLanceDb: string;
  indexRuntime: string;
  indexProgress: string;
  lastRepositoryState: string;
  modesCatalog: string;
  agentsDir: string;
  recipesDir: string;
  skillsDir: string;
  safety: string;
  checkpointsDir: string;
  memoryDir: string;
  automationDb: string;
  bundledModelsDir: string;
}

/**
 * Resolve where Mitii CLI reads/writes durable state for a workspace.
 * Log dir: MITII_LOGS_PATH if set, else <cwd>/.mitii/logs
 */
export function resolveMitiiCliPaths(cwd: string): MitiiCliPaths {
  const root = resolve(cwd);
  const mitii = join(root, '.mitii');
  const projectConfig = join(mitii, 'config.json');
  const globalConfig = join(homedir(), '.mitii', 'config.json');
  const envLogs = process.env.MITII_LOGS_PATH?.trim();
  const logsDir = envLogs && envLogs.length > 0 ? resolve(envLogs) : join(mitii, 'logs');
  const automationDb =
    process.env.MITII_AUTOMATION_DB?.trim() ||
    join(homedir(), '.mitii', 'automation', 'automation.db');

  let activeConfig: string | null = null;
  if (existsSync(projectConfig)) activeConfig = projectConfig;
  else if (existsSync(globalConfig)) activeConfig = globalConfig;

  return {
    cwd: root,
    projectConfig,
    globalConfig,
    activeConfig,
    projectDotEnv: join(root, '.env'),
    projectMitiiDotEnv: join(mitii, '.env'),
    globalDotEnv: join(homedir(), '.mitii', '.env'),
    logsDir,
    logsDirSource: envLogs && envLogs.length > 0 ? 'MITII_LOGS_PATH' : 'workspace',
    indexSqlite: join(mitii, 'repository-index.sqlite'),
    indexLanceDb: join(mitii, 'lancedb'),
    indexRuntime: join(mitii, 'index-runtime.json'),
    indexProgress: join(mitii, 'index-progress.json'),
    lastRepositoryState: join(mitii, 'last-repository-state.json'),
    modesCatalog: join(mitii, MODE_CATALOG_FILENAME),
    agentsDir: join(mitii, 'agents'),
    recipesDir: join(mitii, 'recipes'),
    skillsDir: join(mitii, 'skills'),
    safety: join(mitii, 'safety.json'),
    checkpointsDir: join(mitii, 'checkpoints'),
    memoryDir: join(mitii, 'memory'),
    automationDb,
    bundledModelsDir: join(homedir(), '.mitii', 'models'),
  };
}

export function formatMitiiCliPaths(paths: MitiiCliPaths): string {
  const exists = (p: string) => (existsSync(p) ? 'yes' : 'no');
  const lines = [
    `cwd:                    ${paths.cwd}`,
    `active config:          ${paths.activeConfig ?? '(none — run mitii setup)'}`,
    `project config:         ${paths.projectConfig}  [${exists(paths.projectConfig)}]`,
    `global config:          ${paths.globalConfig}  [${exists(paths.globalConfig)}]`,
    `project .env:           ${paths.projectDotEnv}  [${exists(paths.projectDotEnv)}]`,
    `project .mitii/.env:    ${paths.projectMitiiDotEnv}  [${exists(paths.projectMitiiDotEnv)}]`,
    `global .mitii/.env:     ${paths.globalDotEnv}  [${exists(paths.globalDotEnv)}]`,
    `logs dir:               ${paths.logsDir}  (source: ${paths.logsDirSource})  [${exists(paths.logsDir)}]`,
    `index sqlite:           ${paths.indexSqlite}  [${exists(paths.indexSqlite)}]`,
    `index vectors:          ${paths.indexLanceDb}  [${exists(paths.indexLanceDb)}]`,
    `index runtime:          ${paths.indexRuntime}  [${exists(paths.indexRuntime)}]`,
    `last repository state:  ${paths.lastRepositoryState}  [${exists(paths.lastRepositoryState)}]`,
    `modes catalog:          ${paths.modesCatalog}  [${exists(paths.modesCatalog)}]`,
    `agents:                 ${paths.agentsDir}  [${exists(paths.agentsDir)}]`,
    `recipes:                ${paths.recipesDir}  [${exists(paths.recipesDir)}]`,
    `skills:                 ${paths.skillsDir}  [${exists(paths.skillsDir)}]`,
    `safety:                 ${paths.safety}  [${exists(paths.safety)}]`,
    `checkpoints:            ${paths.checkpointsDir}  [${exists(paths.checkpointsDir)}]`,
    `memory:                 ${paths.memoryDir}  [${exists(paths.memoryDir)}]`,
    `automation db:          ${paths.automationDb}  [${exists(paths.automationDb)}]`,
    `bundled models cache:   ${paths.bundledModelsDir}  [${exists(paths.bundledModelsDir)}]`,
  ];
  return `${lines.join('\n')}\n`;
}
