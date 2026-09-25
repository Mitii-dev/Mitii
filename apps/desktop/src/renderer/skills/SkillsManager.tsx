/**
 * Full-screen Code-mode Skills manager: list, add, MD preview/edit, AI frontmatter.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '../ActivityIcons.js';
import {
  deleteWorkspaceSkillApi,
  fetchWorkspaceSkill,
  fetchWorkspaceSkills,
  formatWorkspaceSkill,
  saveWorkspaceSkill,
} from '../api.js';
import { MarkdownBody } from '../chat/MarkdownBody.js';

interface SkillRow {
  id: string;
  title: string;
  description: string;
}

interface Props {
  baseUrl: string;
  token?: string;
  /** Active profile name (required to add/save). */
  activeProfileName?: string | null;
  hasActiveProfile: boolean;
  onOpenProfiles?: () => void;
}

type ViewMode = 'preview' | 'edit';

const NEW_BODY = `# My skill

When this skill is selected, follow these instructions:

1. Clarify the goal if needed
2. Inspect the repository before changing files
3. Prefer small, verifiable changes
`;

export function SkillsManager(props: Props) {
  const auth = { baseUrl: props.baseUrl, token: props.token };
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [dirty, setDirty] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await fetchWorkspaceSkills(auth);
      setSkills(list);
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
    window.setTimeout(() => setNote(null), 2200);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const openSkill = async (skillId: string) => {
    setBusy(true);
    try {
      const skill = await fetchWorkspaceSkill({ ...auth, id: skillId });
      setSelectedId(skill.id);
      setIsNew(false);
      setId(skill.id);
      setTitle(skill.title);
      setMarkdown(skill.markdown || skill.body);
      setViewMode('preview');
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    if (!props.hasActiveProfile) {
      setError('active_profile_required');
      return;
    }
    const stamp = Date.now().toString(36);
    setSelectedId(`new-${stamp}`);
    setIsNew(true);
    setId(`my-skill-${stamp}`);
    setTitle('My skill');
    setMarkdown(NEW_BODY);
    setViewMode('edit');
    setDirty(true);
    setError(null);
  };

  const closeEditor = () => {
    setSelectedId(null);
    setIsNew(false);
    setDirty(false);
    setMarkdown('');
  };

  const save = async () => {
    if (!props.hasActiveProfile) {
      setError('active_profile_required');
      return;
    }
    setBusy(true);
    try {
      const result = await saveWorkspaceSkill({
        ...auth,
        id: id.trim() || undefined,
        title: title.trim() || undefined,
        markdown,
        formatFrontmatter: true,
        useAi: true,
      });
      setId(result.id);
      setIsNew(false);
      setSelectedId(result.id);
      if (result.skill?.markdown) {
        setMarkdown(result.skill.markdown);
        setTitle(result.skill.title);
      } else {
        const refreshed = await fetchWorkspaceSkill({
          ...auth,
          id: result.id,
        });
        setMarkdown(refreshed.markdown || refreshed.body);
        setTitle(refreshed.title);
      }
      setViewMode('preview');
      setDirty(false);
      await reload();
      const aiNote = result.usedAi
        ? `Frontmatter formatted with ${result.profileName ?? 'active profile'} (${result.recipeId ?? 'skill-frontmatter'})`
        : 'Saved with deterministic frontmatter';
      flash(`Saved ${result.path} — ${aiNote}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const formatOnly = async () => {
    if (!props.hasActiveProfile) {
      setError('active_profile_required');
      return;
    }
    setBusy(true);
    try {
      const result = await formatWorkspaceSkill({
        ...auth,
        id: id.trim() || undefined,
        title: title.trim() || undefined,
        markdown,
        useAi: true,
      });
      setMarkdown(result.markdown);
      setId(result.id);
      setTitle(result.title);
      setDirty(true);
      flash(
        result.usedAi
          ? `Frontmatter updated via ${result.profileName} · body unchanged`
          : 'Frontmatter updated (fallback) · body unchanged',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skillId: string) => {
    if (!props.hasActiveProfile) {
      setError('active_profile_required');
      return;
    }
    if (!window.confirm(`Delete skill “${skillId}” from .mitii/skills?`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteWorkspaceSkillApi({ ...auth, id: skillId });
      if (selectedId === skillId) closeEditor();
      await reload();
      flash(`Deleted ${skillId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const profileBlocked = !props.hasActiveProfile;
  const profileError =
    error?.includes('active_profile_required') === true
      ? 'Select an active profile before adding or saving skills. Skills use your profile model to format frontmatter.'
      : error;

  return (
    <div className="skills-manager">
      <header className="skills-manager__header">
        <div className="skills-manager__title-block">
          <h2>Skills</h2>
          <p>
            Custom playbooks under <code>.mitii/skills/</code>. On save, Mitii
            runs the internal <code>skill-frontmatter</code> recipe with your
            active profile to format YAML metadata while keeping the markdown
            body intact.
          </p>
        </div>
        <div className="skills-manager__header-actions">
          {props.activeProfileName ? (
            <span className="skills-manager__profile">
              Profile · {props.activeProfileName}
            </span>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => props.onOpenProfiles?.()}
            >
              Choose profile
            </button>
          )}
          <button
            type="button"
            className="btn-primary skills-manager__add"
            disabled={busy || profileBlocked}
            title={
              profileBlocked
                ? 'Active profile required'
                : 'Add a custom skill'
            }
            onClick={startNew}
          >
            <IconPlus size={15} />
            Add skill
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
      </header>

      {profileBlocked ? (
        <div className="skills-manager__banner" role="status">
          <strong>Active profile required.</strong>
          <span>
            Pick a profile so Mitii can format skill frontmatter with your
            model.
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => props.onOpenProfiles?.()}
          >
            Open profiles
          </button>
        </div>
      ) : null}

      {!selectedId ? (
        <>
          <div className="skills-manager__search skills-manager__search--gallery">
            <IconSearch size={16} />
            <input
              type="search"
              value={query}
              placeholder="Search skills…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search skills"
            />
          </div>

          <div className="profile-gallery skills-manager__gallery">
            {filtered.map((skill) => {
              const initial = (skill.title.trim()[0] || '?').toUpperCase();
              return (
                <div key={skill.id} className="profile-tile">
                  <button
                    type="button"
                    className="profile-tile__body"
                    onClick={() => void openSkill(skill.id)}
                  >
                    <span className="profile-tile__avatar" aria-hidden>
                      {initial}
                    </span>
                    <span className="profile-tile__name">{skill.title}</span>
                    <span className="profile-tile__meta">
                      {skill.description || skill.id}
                    </span>
                    <span className="profile-tile__badge profile-tile__badge--edit">
                      Open
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mcp-manager__tile-delete"
                    title={`Delete ${skill.id}`}
                    aria-label={`Delete ${skill.id}`}
                    disabled={busy || profileBlocked}
                    onClick={() => void remove(skill.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="profile-tile profile-tile--add"
              disabled={busy || profileBlocked}
              title={
                profileBlocked
                  ? 'Active profile required'
                  : 'Add a custom skill'
              }
              onClick={startNew}
            >
              <span className="profile-tile__avatar" aria-hidden>
                +
              </span>
              <span className="profile-tile__name">New skill</span>
              <span className="profile-tile__meta">
                Markdown playbook for this workspace
              </span>
            </button>
          </div>

          {filtered.length === 0 && skills.length > 0 ? (
            <p className="workspace-empty">No skills match your search.</p>
          ) : null}
        </>
      ) : (
        <section className="skills-manager__editor skills-manager__editor--solo">
          <div className="skills-manager__toolbar">
            <div className="skills-manager__meta">
              <label>
                Id
                <input
                  value={id}
                  disabled={!isNew || busy}
                  onChange={(e) => {
                    setId(e.target.value);
                    setDirty(true);
                  }}
                  spellCheck={false}
                />
              </label>
              <label>
                Title hint
                <input
                  value={title}
                  disabled={busy}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </div>
            <div className="skills-manager__modes" role="tablist">
              <button
                type="button"
                className={viewMode === 'preview' ? 'is-active' : undefined}
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                className={viewMode === 'edit' ? 'is-active' : undefined}
                onClick={() => setViewMode('edit')}
              >
                Edit
              </button>
            </div>
            <div className="skills-manager__actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || profileBlocked}
                onClick={() => void formatOnly()}
              >
                Format frontmatter
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={closeEditor}
              >
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || profileBlocked || !markdown.trim()}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : dirty ? 'Save skill' : 'Saved'}
              </button>
            </div>
          </div>

          {viewMode === 'preview' ? (
            <div className="skills-manager__preview">
              <MarkdownBody text={markdown} />
            </div>
          ) : (
            <textarea
              className="skills-manager__textarea"
              value={markdown}
              spellCheck={false}
              disabled={busy}
              onChange={(e) => {
                setMarkdown(e.target.value);
                setDirty(true);
              }}
              placeholder="# Playbook body (frontmatter is added on save)"
            />
          )}
        </section>
      )}

      {note ? <p className="ext-note">{note}</p> : null}
      {profileError ? <p className="ext-error">{profileError}</p> : null}
    </div>
  );
}
