/**
 * Left-rail module palette. Static modules plus MCP, skills, and recipes
 * already configured in Desktop. Drag any of them onto the canvas.
 */

import {
  AUTOMATION_MODULES,
  catalogModules,
  type AutomationCatalogRefs,
  type AutomationModuleDef,
  type ModuleCategory,
} from '../../shared/automations/modules.js';
import { MODULE_DRAG_MIME } from '../../shared/automations/applyModule.js';
import { isCatalogAttachment, type AutomationFlowDocument } from '../../shared/automations/flow.js';

const CATEGORY_ORDER: ModuleCategory[] = [
  'trigger',
  'step',
  'agent',
  'mcp',
  'skill',
  'recipe',
];

const CATEGORY_LABEL: Record<ModuleCategory, string> = {
  trigger: 'Triggers',
  step: 'Steps',
  agent: 'Agent',
  mcp: 'MCP',
  skill: 'Skills',
  recipe: 'Recipes',
};

const CATEGORY_EMPTY: Partial<Record<ModuleCategory, string>> = {
  mcp: 'No MCP servers configured in Desktop.',
  skill: 'No skills in the catalog.',
  recipe: 'No recipes available.',
};

export interface ModulePaletteProps {
  catalog?: AutomationCatalogRefs;
  flow?: AutomationFlowDocument;
  onQuickAdd?: (mod: AutomationModuleDef) => void;
}

export function ModulePalette(props: ModulePaletteProps) {
  const { onQuickAdd, catalog, flow } = props;
  const dynamic = catalogModules(catalog);
  const modules = [...AUTOMATION_MODULES, ...dynamic];

  return (
    <aside className="module-palette" aria-label="Automation modules">
      <h3 className="module-palette__title">Modules</h3>
      <p className="module-palette__hint">
        Drag a module onto the canvas. MCP, skills, and recipes attach as
        nodes wired into the agent.
      </p>
      {CATEGORY_ORDER.map((cat) => {
        const items = modules.filter((m) => m.category === cat);
        const empty = CATEGORY_EMPTY[cat];
        if (items.length === 0 && !empty) return null;
        return (
          <div key={cat} className="module-palette__group">
            <div className="module-palette__group-label">
              {CATEGORY_LABEL[cat]}
            </div>
            {items.length === 0 ? (
              <p className="module-palette__empty">{empty}</p>
            ) : (
              <ul className="module-palette__list">
                {items.map((mod) => {
                  const attached = isAttached(flow, mod);
                  return (
                    <li key={mod.id}>
                      <button
                        type="button"
                        className={[
                          `module-tile module-tile--${mod.accent}`,
                          attached ? 'module-tile--attached' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        draggable
                        title={mod.description}
                        onDragStart={(e) => {
                          const payload = JSON.stringify(mod);
                          e.dataTransfer.setData(MODULE_DRAG_MIME, payload);
                          e.dataTransfer.setData('text/plain', payload);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onQuickAdd?.(mod)}
                      >
                        <span className="module-tile__title">{mod.title}</span>
                        <span className="module-tile__desc">
                          {attached ? 'Attached' : mod.description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function isAttached(
  flow: AutomationFlowDocument | undefined,
  mod: AutomationModuleDef,
): boolean {
  if (!flow || mod.apply.type !== 'attach') return false;
  const { kind, refId } = mod.apply;
  return flow.steps.some((step) => {
    if (!isCatalogAttachment(step.kind) || step.kind !== kind) return false;
    if (step.kind === 'mcp') return step.serverId === refId;
    if (step.kind === 'skill') return step.skillId === refId;
    return step.recipeId === refId;
  });
}
