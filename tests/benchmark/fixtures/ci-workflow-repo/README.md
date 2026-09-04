# ci-workflow-repo

Small repo with a deliberately incomplete `.github/workflows/ci.yml`: it only
triggers on `push` to `main` (no `pull_request`), and only has a `build` job
— `npm test` never runs in CI at all, patterned after the gaps a real
`ci.yml` review would catch (compare `ci.yml` at the repo root).

Used for `cicd/cases/workflow-authoring.jsonl`: add `pull_request` as a
trigger and a `test` job that installs dependencies and runs `npm test`.
