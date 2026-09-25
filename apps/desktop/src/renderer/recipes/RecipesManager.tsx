/**
 * Full-screen Code-mode Recipes manager — Netflix-style tiles like profiles.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
} from '../ActivityIcons.js';
import { fetchRecipes, runRecipe, saveRecipe } from '../api.js';

const CREATE_RECIPE_LOCKED = true;
const CREATE_RECIPE_LOCKED_HINT = 'Coming soon';

interface RecipeRow {
  id: string;
  title: string;
  description: string;
  source: 'builtin' | 'workspace';
  mode: 'ask' | 'plan' | 'agent';
}

interface Props {
  baseUrl: string;
  token?: string;
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
}

export function RecipesManager(props: Props) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [query, setQuery] = useState('');
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

  const flash = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote(null), 1800);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.mode.toLowerCase().includes(q),
    );
  }, [recipes, query]);

  const run = async (id: string) => {
    setBusy(true);
    try {
      const result = await runRecipe({ ...auth, id });
      props.onUsePrompt?.(result.compiled.prompt, result.compiled.mode);
      flash(`Loaded “${result.compiled.title}” into composer`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
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
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(draftJson) as Record<string, unknown>;
      const saved = await saveRecipe({ ...auth, recipe: parsed });
      flash(`Saved ${saved.path}`);
      setCreating(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="recipes-manager">
      <header className="recipes-manager__header">
        <div className="recipes-manager__title-block">
          <h2>Recipes</h2>
          <p>
            Curated prompts that load into chat. Open a tile to use one.
            {CREATE_RECIPE_LOCKED
              ? ' Custom workspace recipes are coming soon.'
              : ' Or create a workspace recipe.'}
          </p>
        </div>
        <div className="recipes-manager__header-actions">
          {!creating ? (
            <span
              className="recipes-manager__locked-hit"
              title={
                CREATE_RECIPE_LOCKED ? CREATE_RECIPE_LOCKED_HINT : undefined
              }
            >
              <button
                type="button"
                className={`btn-primary recipes-manager__add${
                  CREATE_RECIPE_LOCKED ? ' is-locked' : ''
                }`}
                disabled={busy && !CREATE_RECIPE_LOCKED}
                aria-disabled={CREATE_RECIPE_LOCKED || busy}
                tabIndex={CREATE_RECIPE_LOCKED ? -1 : undefined}
                title={
                  CREATE_RECIPE_LOCKED
                    ? CREATE_RECIPE_LOCKED_HINT
                    : 'New recipe'
                }
                onClick={
                  CREATE_RECIPE_LOCKED
                    ? (e) => e.preventDefault()
                    : startCreate
                }
              >
                {CREATE_RECIPE_LOCKED ? (
                  <IconLock size={15} />
                ) : (
                  <IconPlus size={15} />
                )}
                New recipe
              </button>
            </span>
          ) : null}
          <button
            type="button"
            className="icon-quiet"
            title="Refresh"
            onClick={() => void reload()}
          >
            <IconRefresh size={16} />
          </button>
        </div>
      </header>

      {creating && !CREATE_RECIPE_LOCKED ? (
        <div className="recipes-manager__editor">
          <label>
            Recipe JSON
            <textarea
              value={draftJson}
              rows={16}
              onChange={(e) => setDraftJson(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="recipes-manager__editor-actions">
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
        <>
          <div className="recipes-manager__search">
            <IconSearch size={16} />
            <input
              type="search"
              value={query}
              placeholder="Search recipes…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search recipes"
            />
          </div>

          <div className="profile-gallery recipes-manager__gallery">
            {filtered.map((recipe) => {
              const initial = (recipe.title.trim()[0] || '?').toUpperCase();
              return (
                <div key={`${recipe.source}:${recipe.id}`} className="profile-tile">
                  <button
                    type="button"
                    className="profile-tile__body"
                    disabled={busy}
                    onClick={() => void run(recipe.id)}
                    title={`Use ${recipe.title}`}
                  >
                    <span className="profile-tile__avatar" aria-hidden>
                      {initial}
                    </span>
                    <span className="profile-tile__name">{recipe.title}</span>
                    <span className="profile-tile__meta">
                      {recipe.source === 'builtin' ? 'Built-in' : 'Workspace'} ·{' '}
                      {recipe.mode}
                      {recipe.description ? ` · ${recipe.description}` : ''}
                    </span>
                    <span className="profile-tile__badge profile-tile__badge--edit">
                      Use
                    </span>
                  </button>
                </div>
              );
            })}
            <span
              className="recipes-manager__locked-hit"
              title={
                CREATE_RECIPE_LOCKED ? CREATE_RECIPE_LOCKED_HINT : undefined
              }
            >
              <button
                type="button"
                className={`profile-tile profile-tile--add${
                  CREATE_RECIPE_LOCKED ? ' is-locked' : ''
                }`}
                disabled={busy && !CREATE_RECIPE_LOCKED}
                aria-disabled={CREATE_RECIPE_LOCKED || busy}
                tabIndex={CREATE_RECIPE_LOCKED ? -1 : undefined}
                title={
                  CREATE_RECIPE_LOCKED
                    ? CREATE_RECIPE_LOCKED_HINT
                    : 'New recipe'
                }
                onClick={
                  CREATE_RECIPE_LOCKED
                    ? (e) => e.preventDefault()
                    : startCreate
                }
              >
                <span className="profile-tile__avatar" aria-hidden>
                  {CREATE_RECIPE_LOCKED ? <IconLock size={20} /> : '+'}
                </span>
                <span className="profile-tile__name">New recipe</span>
                <span className="profile-tile__meta">
                  {CREATE_RECIPE_LOCKED
                    ? 'Coming soon'
                    : 'JSON recipe for this workspace'}
                </span>
              </button>
            </span>
          </div>

          {filtered.length === 0 && recipes.length > 0 ? (
            <p className="workspace-empty">No recipes match your search.</p>
          ) : null}
        </>
      )}

      {note ? <p className="ext-note">{note}</p> : null}
      {error ? <p className="ext-error">{error}</p> : null}
    </div>
  );
}
