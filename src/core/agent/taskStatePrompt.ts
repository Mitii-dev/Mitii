export const STATE_MACHINE_GUIDANCE = `
TASK PHASES (strict state machine):
1. **Phase 1 — Analyze**: Read files, list_files, depcheck, eslint (read-only), search. Run each diagnostic AT MOST ONCE per session.
2. **Phase 2 — Execute**: apply_patch, write_file, package.json edits, npm uninstall. Required before repeating Phase 1 diagnostics.
3. **Phase 3 — Verify**: diagnostics, lint, test, build after changes.

Rules:
- Once depcheck/eslint/list_files succeeds, FORBIDDEN to run the same diagnostic again until Phase 2 has modified at least one file.
- Before pausing for approval, call save_task_state (or memory_write) with a brief progress summary.
- On continuation/resumption, read ## Recent conversation and ## Task progress FIRST — do NOT call memory_search as your first action.`;

export const CHAT_HISTORY_GUIDANCE = `
CONTEXT PRIORITY:
1. Recent conversation messages (user + assistant) — includes tool results and prior analysis.
2. ## Task progress section — phase, completed diagnostics, saved pause state.
3. ## Codebase Context — indexed snippets.
4. memory_search — fallback only when chat history lacks the needed fact. Never start a continuation turn with memory_search.`;
