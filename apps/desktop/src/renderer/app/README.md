# App composition root

- `useAppModel.ts` calls the feature hooks (`shell/hooks`, `chat/hooks`, `settings/hooks`, `indexing/hooks`) in dependency order and returns one model (`AppModel`).
- `deriveViewState.ts` holds pure per-render derivations (layout flags, plan-follow view, review state).
- `AppShell.tsx` composes the shell and chat containers; each container receives `m: AppModel` and destructures only what it renders.
- Hook order is effect order — keep new effects at the matching position. Hooks depend only on earlier hooks (typed with `Pick<ReturnType<typeof useX>, …>`).
