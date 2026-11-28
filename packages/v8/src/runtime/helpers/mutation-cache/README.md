# Mutation cache

After successful workspace mutation, invalidate read-only tool content cache /
read ledger / path-tied established facts so verify re-runs against the live tree.

## Owns
- `applySucceededMutationSideEffects`
- `SHELL_MUTATION_MANIFEST_PATHS`

## Does not own
- ToolCallCache / ReadLedger implementations (engine internal)
- Tool execution
