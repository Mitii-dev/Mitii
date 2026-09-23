/**
 * Code-mode side panes: Recipes (MCP/Skills use full-screen managers).
 */

import { useCallback, useEffect, useState } from 'react';

import { IconRefresh } from './ActivityIcons.js';
import {
  fetchRecipes,
  runRecipe,
  saveRecipe,
} from './api.js';

export type ExtensionsSide = 'mcp' | 'skills' | 'recipes';

interface Props {
  baseUrl: string;
  token?: string;
  side: 'recipes';
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onRestartEngine?: () => Promise<void>;
}

export function CodeExtensionsPane(props: Props) {
  return (
    <RecipesPane
      baseUrl={props.baseUrl}
      token={props.token}
      onUsePrompt={props.onUsePrompt}
    />
  );
}

function RecipesPane(props: {
  baseUrl: string;
  token?: string;
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
}) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [recipes, setRecipes] = useState<
    Array<{
      id: string;
      title: string;
      description: string;
      source: 'builtin' | 'workspace';
      mode: 'ask' | 'plan' | 'agent';
    }>
  >([]);
  const [creating, setCreating] = useState(false);
  const [draftJson, setDraftJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchRecipes(auth);
      setRecipes(next.recipes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (id: string) => {
    setBusy(true);
    try {
      const result = await runRecipe({ ...auth, id });
      props.onUsePrompt?.(result.compiled.prompt, result.compiled.mode);
      setNote(`Loaded “${result.compiled.title}” into composer`);
      window.setTimeout(() => setNote(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(draftJson) as Record<string, unknown>;
      const saved = await saveRecipe({ ...auth, recipe: parsed });
      setNote(`Saved ${saved.path}`);
      setCreating(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="workspace-pane__title">
        <span>Recipes</span>
        <div className="workspace-pane__actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDraftJson(
                JSON.stringify(
                  {
                    schemaVersion: 1,
                    id: `recipe-${Date.now().toString(36)}`,
                    title: 'My recipe',
                    description: 'Custom Mitii recipe',
                    mode: 'ask',
                    requiredSkillIds: [],
                    promptTemplate:
                      'Follow this recipe carefully.\n\n## Goal\n{{goal}}\n',
                    params: [
                      {
                        name: 'goal',
                        description: 'What should Mitii accomplish?',
                        required: true,
                        default: '',
                      },
                    ],
                  },
                  null,
                  2,
                ),
              );
              setCreating(true);
            }}
          >
            New
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="Refresh"
            onClick={() => void reload()}
          >
          <IconRefresh size={16} />
          </button>
        </div>
      </div>
      <div className="ext-pane">
        {creating ? (
          <div className="ext-editor">
            <label>
              Recipe JSON
              <textarea
                value={draftJson}
                rows={14}
                onChange={(e) => setDraftJson(e.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="ext-editor__actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                Save recipe
              </button>
            </div>
          </div>
        ) : (
          <ul className="ext-list">
            {recipes.map((recipe) => (
              <li key={`${recipe.source}:${recipe.id}`} className="ext-row">
                <div className="ext-row__main">
                  <strong>{recipe.title}</strong>
                  <small>
                    {recipe.source === 'builtin' ? 'Built-in' : 'Workspace'} ·{' '}
                    {recipe.mode}
                    {recipe.description ? ` — ${recipe.description}` : ''}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void run(recipe.id)}
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
        )}
        {note ? <p className="ext-note">{note}</p> : null}
        {error ? <p className="ext-error">{error}</p> : null}
      </div>
    </>
  );
}
