# Chat

Composer, chronological activity timeline, markdown, mentions, plan strips, history nav.

## Assistant turn composition

1. **ActivityTimeline** — chronological flow of thinking → tools → thinking. Live “Brainstorming” uses a soft typewriter catch-up (`thinkingTypeReveal`) with a thin caret; settled segments show “Thought for Xs” (expandable). No full-chat enter animations.
2. **McpAppCard** — diagram cards when present (not inlined in the timeline list).
3. **MarkdownBody** — answer text after the timeline (only once content exists).
4. **FileChangesCard** — write-tool mutations after the answer.

Stream paints update immediately as events arrive; typing reveal is local presentation only. `prefers-reduced-motion` skips typing/caret motion.

Not an activity-bar side — layout toggles (Chat / Code) live in `shell/AppTopbar.tsx` via `shell/hooks/useShellActions.ts`. Wire contract: `shared/protocol.ts` (`mitii-desktop/v1` prompt stream).

## Containers and hooks

`ChatPanel` → `ChatFeed` + `ApprovalCard` + `ChatComposer` (+ `SuggestMenu`). State and actions live in `hooks/` (`useRunSubmit`, `useRunResume`, `useRunStream`, `useThreadActions`, `useSuspensionActions`, `usePlanActions`, …) and are wired by `app/useAppModel.ts`.
