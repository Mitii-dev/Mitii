# GitHub Actions

Mitii can run headlessly in CI for comment-triggered tasks.

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  mitii:
    if: contains(github.event.comment.body, '/mitii')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      - run: pnpm run compile:cli
      - run: node dist/cli.js agent "${{ github.event.comment.body }}" --provider echo --approval auto --json
```

For real providers, pass secrets through environment variables and keep approval mode conservative on public repositories.
