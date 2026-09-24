/**
 * Automation module catalog.
 * Palette items compose a flow. MCP, skills, and recipes are attached on
 * the Agent from catalogs already configured in Desktop — not set up here.
 */

export type ModuleCategory = 'trigger' | 'step' | 'agent' | 'mcp' | 'skill' | 'recipe';

/** Integration ids stored under .mitii/connections.json (runner secrets). */
export type ConnectionId =
  | 'github'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'webhook'
  | 'mcp'
  | 'local_git';

export interface AutomationModuleDef {
  id: string;
  title: string;
  description: string;
  category: ModuleCategory;
  accent: string;
  apply:
    | {
        type: 'trigger';
        trigger: 'schedule' | 'event' | 'manual';
        eventType?: string;
      }
    | { type: 'step'; stepKind: 'command' }
    | { type: 'agent' }
    | {
        type: 'attach';
        kind: 'mcp' | 'skill' | 'recipe';
        refId: string;
      };
}

export const AUTOMATION_MODULES: AutomationModuleDef[] = [
  {
    id: 'mod.manual',
    title: 'Trigger',
    description: 'Run this flow now',
    category: 'trigger',
    accent: 'manual',
    apply: { type: 'trigger', trigger: 'manual' },
  },
  {
    id: 'mod.commit',
    title: 'On commit',
    description: 'Local git commit',
    category: 'trigger',
    accent: 'git',
    apply: {
      type: 'trigger',
      trigger: 'event',
      eventType: 'git.commit.local',
    },
  },
  {
    id: 'mod.command',
    title: 'Command',
    description: 'Run a command; pass output on',
    category: 'step',
    accent: 'command',
    apply: { type: 'step', stepKind: 'command' },
  },
  {
    id: 'mod.agent',
    title: 'Agent',
    description: 'Mode, message, profile, attachments',
    category: 'agent',
    accent: 'agent',
    apply: { type: 'agent' },
  },
];

export function moduleById(id: string): AutomationModuleDef | undefined {
  return AUTOMATION_MODULES.find((m) => m.id === id);
}

export interface AutomationCatalogRefs {
  mcpServers: Array<{ id: string; name: string }>;
  skills: Array<{ id: string; title: string }>;
  recipes: Array<{ id: string; title: string }>;
}

/** Palette entries for MCP, skills, and recipes already configured in Desktop. */
export function catalogModules(
  catalog: AutomationCatalogRefs | undefined,
): AutomationModuleDef[] {
  if (!catalog) return [];
  const mcp = catalog.mcpServers.map((server) => ({
    id: `attach.mcp.${server.id}`,
    title: server.name || server.id,
    description: server.id,
    category: 'mcp' as const,
    accent: 'mcp',
    apply: {
      type: 'attach' as const,
      kind: 'mcp' as const,
      refId: server.id,
    },
  }));
  const skills = catalog.skills.map((skill) => ({
    id: `attach.skill.${skill.id}`,
    title: skill.title || skill.id,
    description: skill.id,
    category: 'skill' as const,
    accent: 'recipe',
    apply: {
      type: 'attach' as const,
      kind: 'skill' as const,
      refId: skill.id,
    },
  }));
  const recipes = catalog.recipes.map((recipe) => ({
    id: `attach.recipe.${recipe.id}`,
    title: recipe.title || recipe.id,
    description: recipe.id,
    category: 'recipe' as const,
    accent: 'recipe',
    apply: {
      type: 'attach' as const,
      kind: 'recipe' as const,
      refId: recipe.id,
    },
  }));
  return [...mcp, ...skills, ...recipes];
}

export function parseDraggedModule(raw: string): AutomationModuleDef | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as AutomationModuleDef;
      if (parsed && typeof parsed.id === 'string' && parsed.apply) {
        return parsed;
      }
    } catch {
      return undefined;
    }
  }
  return (
    moduleById(text) ??
    undefined
  );
}
