/** Route table for the desktop engine HTTP server. */

import type { Route } from '../http/types.js';
import { healthRoutes } from './health.js';
import { chatRoutes } from './chat.js';
import { skillsRoutes } from './skills.js';
import { mcpRoutes } from './mcp.js';
import { recipesRoutes } from './recipes.js';
import { workspaceRoutes } from './workspace.js';
import { gitRoutes } from './git.js';
import { providerRoutes } from './provider.js';
import { memoryRoutes } from './memory.js';
import { checkpointsRoutes } from './checkpoints.js';
import { profilesRoutes } from './profiles.js';
import { historyRoutes } from './history.js';
import { indexStatusRoutes } from './indexStatus.js';
import { evidenceRoutes } from './evidence.js';

export const ENGINE_ROUTES: readonly Route[] = [
  ...healthRoutes,
  ...chatRoutes,
  ...skillsRoutes,
  ...mcpRoutes,
  ...recipesRoutes,
  ...workspaceRoutes,
  ...gitRoutes,
  ...providerRoutes,
  ...memoryRoutes,
  ...checkpointsRoutes,
  ...profilesRoutes,
  ...historyRoutes,
  ...indexStatusRoutes,
  ...evidenceRoutes,
];

export function findRoute(method: string, path: string): Route | undefined {
  return ENGINE_ROUTES.find(
    (route) =>
      route.method === method &&
      (route.path !== undefined ? route.path === path : route.match?.(path) === true),
  );
}
