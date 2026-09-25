/**
 * Top-bar git branch switcher — sits beside the workspace control.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { IconGit } from '../ActivityIcons.js';
import {
  fetchGitBranches,
  fetchGitStatus,
  gitCheckoutBranch,
} from '../api.js';

interface TopBranchSelectProps {
  baseUrl?: string;
  token?: string;
  workspaceRoot?: string;
  disabled?: boolean;
  /** Fired after a successful checkout/create so SCM can refresh. */
  onChanged?: () => void;
}

export function TopBranchSelect(props: TopBranchSelectProps) {
  const [branch, setBranch] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [ok, setOk] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const auth =
    props.baseUrl != null
      ? { baseUrl: props.baseUrl, token: props.token }
      : null;

  const refresh = useCallback(async () => {
    if (!auth) {
      setOk(false);
      setBranch(null);
      setBranches([]);
      return;
    }
    try {
      const status = await fetchGitStatus(auth);
      setOk(status.ok);
      setBranch(status.branch ?? null);
      setAhead(status.ahead ?? 0);
      setBehind(status.behind ?? 0);
    } catch {
      setOk(false);
      setBranch(null);
    }
  }, [props.baseUrl, props.token]);

  const loadBranches = useCallback(async () => {
    if (!auth) return;
    try {
      const next = await fetchGitBranches(auth);
      if (next.ok) setBranches(next.branches);
    } catch {
      /* non-fatal */
    }
  }, [props.baseUrl, props.token]);

  useEffect(() => {
    void refresh();
    setOpen(false);
    setNewBranch('');
  }, [refresh, props.workspaceRoot]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const runCheckout = async (name: string, create: boolean) => {
    if (!auth || !name.trim()) return;
    setBusy(true);
    try {
      const result = await gitCheckoutBranch({
        ...auth,
        branch: name.trim(),
        create,
      });
      if (!result.ok) return;
      setOpen(false);
      setNewBranch('');
      await refresh();
      void loadBranches();
      props.onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const syncLabel =
    ahead || behind
      ? [
          ahead ? `↑${ahead}` : null,
          behind ? `↓${behind}` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : null;

  const locked = Boolean(props.disabled || busy || !auth);

  return (
    <div className="top-select top-branch" ref={rootRef}>
      <button
        type="button"
        className="top-select__trigger top-select__trigger--branch"
        disabled={locked || !ok}
        aria-expanded={open}
        title={
          !auth
            ? 'Open a workspace'
            : !ok
              ? 'No git repository'
              : 'Switch or create branch'
        }
        onClick={() => {
          if (locked || !ok) return;
          setOpen((v) => {
            const next = !v;
            if (next) void loadBranches();
            return next;
          });
        }}
      >
        <IconGit size={14} />
        <span className="top-select__label">Branch</span>
        <span className="top-select__value">
          {branch ?? (ok ? '…' : '—')}
        </span>
        {syncLabel ? (
          <span className="top-branch__sync">{syncLabel}</span>
        ) : null}
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="top-select__menu top-select__menu--branch" role="listbox">
          <div className="top-branch__create">
            <input
              value={newBranch}
              placeholder="Create branch…"
              disabled={busy}
              autoFocus
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranch.trim()) {
                  e.preventDefault();
                  void runCheckout(newBranch, true);
                }
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <button
              type="button"
              className="top-branch__create-btn"
              disabled={busy || !newBranch.trim()}
              onClick={() => void runCheckout(newBranch, true)}
            >
              Create
            </button>
          </div>
          {branches.length === 0 ? (
            <p className="top-select__empty">No branches found</p>
          ) : (
            branches.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                className={name === branch ? 'is-selected' : undefined}
                disabled={busy || name === branch}
                onClick={() => void runCheckout(name, false)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
