/**
 * Code-mode side panes: MCP, Skills, Recipes.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  fetchMcpServers,
  fetchRecipes,
  fetchWorkspaceSkill,
  fetchWorkspaceSkills,
  runRecipe,
  saveRecipe,
  saveWorkspaceSkill,
  setMcpEnabled,
} from './api.js';

export type ExtensionsSide = 'mcp' | 'skills' | 'recipes';

interface Props {
  baseUrl: string;
  token?: string;
  side: ExtensionsSide;
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onRestartEngine?: () => Promise<void>;
}

export function CodeExtensionsPane(props: Props) {
  if (props.side === 'mcp') {
    return (
      <McpPane
        baseUrl={props.baseUrl}
        token={props.token}
        onRestartEngine={props.onRestartEngine}
      />
    );
  }
  if (props.side === 'skills') {
    return <SkillsPane baseUrl={props.baseUrl} token={props.token} />;
  }
  return (
    <RecipesPane
      baseUrl={props.baseUrl}
      token={props.token}
      onUsePrompt={props.onUsePrompt}
    />
  );
}

function McpPane(props: {
  baseUrl: string;
  token?: string;
  onRestartEngine?: () => Promise<void>;
}) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [enabled, setEnabled] = useState(false);
  const [servers, setServers] = useState<
    Array<{
      id: string;
      name: string;
      enabled: boolean;
      transport?: string;
      builtin?: boolean;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchMcpServers(auth);
      setEnabled(next.enabled);
      setServers(next.servers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const apply = async (input: { enabled?: boolean; serverId?: string }) => {
    setBusy(true);
    setNote(null);
    try {
      const next = await setMcpEnabled({ ...auth, ...input });
      setEnabled(next.enabled);
      setServers(next.servers);
      if (next.restartRequired && props.onRestartEngine) {
        await props.onRestartEngine();
        setNote('MCP updated — engine restarted');
      } else {
        setNote('MCP updated');
      }
      window.setTimeout(() => setNote(null), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="workspace-pane__title">
        <span>MCP</span>
        <button
          type="button"
          className="icon-quiet"
          title="Refresh"
          onClick={() => void reload()}
        >
          ↻
        </button>
      </div>
      <div className="ext-pane">
        <label className="ext-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void apply({ enabled: e.target.checked })}
          />
          <span>Enable MCP for this repo</span>
        </label>
        {servers.length === 0 ? (
          <p className="workspace-empty">
            No MCP servers installed. Add them in Settings → MCP.
          </p>
        ) : (
          <ul className="ext-list">
            {servers.map((server) => (
              <li key={server.id} className="ext-row">
                <div className="ext-row__main">
                  <strong>{server.name}</strong>
                  <small>
                    {server.id}
                    {server.transport ? ` · ${server.transport}` : ''}
                    {server.builtin ? ' · builtin' : ''}
                  </small>
                </div>
                <label className="ext-switch">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void apply({
                        serverId: server.id,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  <span>{server.enabled ? 'On' : 'Off'}</span>
                </label>
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

function SkillsPane(props: { baseUrl: string; token?: string }) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [skills, setSkills] = useState<
    Array<{ id: string; title: string; description: string }>
  >([]);
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState('my-skill');
  const [title, setTitle] = useState('My skill');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState(
    '# My skill\n\nWhen selected, follow these instructions.\n',
  );
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setSkills(await fetchWorkspaceSkills(auth));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openSkill = async (skillId: string) => {
    try {
      const skill = await fetchWorkspaceSkill({ ...auth, id: skillId });
      setId(skill.id);
      setTitle(skill.title);
      setDescription(skill.description);
      setBody(skill.body);
      setEditing(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveWorkspaceSkill({
        ...auth,
        id,
        title,
        description,
        body,
      });
      setNote('Skill saved to .mitii/skills');
      window.setTimeout(() => setNote(null), 1600);
      setEditing(false);
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
        <span>Skills</span>
        <div className="workspace-pane__actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setId(`skill-${Date.now().toString(36)}`);
              setTitle('My skill');
              setDescription('Custom workspace skill');
              setBody(
                '# My skill\n\nWhen this skill is selected, follow these instructions.\n',
              );
              setEditing(true);
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
            ↻
          </button>
        </div>
      </div>
      <div className="ext-pane">
        {editing ? (
          <div className="ext-editor">
            <label>
              Id
              <input value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Description
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Instructions
              <textarea
                value={body}
                rows={12}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <div className="ext-editor__actions">
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !id.trim()}
                onClick={() => void save()}
              >
                Save skill
              </button>
            </div>
          </div>
        ) : skills.length === 0 ? (
          <p className="workspace-empty">
            No custom skills yet. Create one to teach Mitii repo-specific
            workflows. Saved under `.mitii/skills/`.
          </p>
        ) : (
          <ul className="ext-list">
            {skills.map((skill) => (
              <li key={skill.id}>
                <button
                  type="button"
                  className="ext-row ext-row--button"
                  onClick={() => void openSkill(skill.id)}
                >
                  <div className="ext-row__main">
                    <strong>{skill.title}</strong>
                    <small>{skill.description || skill.id}</small>
                  </div>
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
            ↻
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
