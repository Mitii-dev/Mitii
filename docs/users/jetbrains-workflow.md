# JetBrains Workflow

The Phase 3 JetBrains path is a thin companion workflow backed by `mitii serve`.

1. Run `mitii serve` from the project root.
2. Use the JetBrains terminal or HTTP client to call the daemon API.
3. Keep VS Code-specific commands disabled; daemon sessions, CLI tasks, jobs, PR creation, and indexing are editor-independent.

A future Kotlin/JCEF companion plugin should bind the open project root to the daemon and render the existing Mitii web UI in a tool window.
