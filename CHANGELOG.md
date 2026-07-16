# Changelog

## [Unreleased]

### Added
- Hardened large-repository indexing with explicit scan/index/cancel phases, partial-index status, progress detail, and "degraded but usable" messaging in the VS Code UI and CLI.
- Expanded first-run onboarding into Echo, local Ollama/OpenAI-compatible, optional cloud key, and safety/index steps with connection testing at each provider stage.
- Promoted `propose_file_scope` to the default Act contract in prompts so file reads and edits are scoped before model tool use.
- Polished async local jobs with worker leases, job show/retry/cancel commands, worker limits, JSON worker events, and overnight-worker documentation.

## [2.7.54] - 2026-07-15

### Added
- Enhanced context panel functionality and improved the chat input and Plan panel layout. (e90ac58)
- Introduced the `propose_file_scope` tool and enhanced file reading guidance so models declare candidate paths before reading or editing. (86216d4)

### Changed
- Refactored path resolution and skill catalog integration for more consistent workspace discovery. (356ddcc)

## [2.7.52] - 2026-07-10

### Added
- Added external file reading with user approval in `ToolExecutor` and related components. (1271094)
- Enhanced native module rebuilding and indexing policy defaults for large workspaces. (3aa756b)

### Changed
- Reordered Act intent feature detection and refreshed README version metadata. (91c0457)
- Updated README version metadata to 2.7.50 and optimized imports in session recovery tests. (9c6ded0)
- Refactored internal code structure for maintainability. (1216666)

## [2.7.50] - 2026-07-07

### Added
- Added base URL, model, and API key support to the manual benchmark runner. (e7f0453)
- Added base URL, model, and API key support to benchmark tasks. (b511bdb)
- Added medium-severity planning benchmark tasks. (1cb4886)
- Enhanced README routing detection so README updates classify as documentation work. (463de7d)

### Changed
- Updated dispose methods to be async and handle promises safely. (c541a8f)

## [2.7.49] - 2026-07-05

### Added
- Added call graph context with language service integration. (a361ad4)
- Added runtime health tracking for embedding providers and vector backends, including degraded-state UI. (dfc81b7)
- Added the retrieval eval harness with additive instrumentation and benchmark tooling. (d28da4c)
- Enhanced PlanActEngine and UI components with clipboard copy support and theme styling updates. (9d1556b)
- Improved token display with input/output details in token chips. (28c4988)

### Changed
- Improved retrieval metrics with deduplication logic. (fbd683a)
- Refined ThinkingRow display, global CSS, agent edit nudges, Markdown patching tests, and generated benchmark timestamps. (c0de1d1)

## [2.7.32] - 2026-07-04

### Added
- Enhanced path resolution and tool guidance. (ad48013)
- Introduced team management and durable job queue services. (af4e6dd)

## [2.7.30] - 2026-07-03

### Added
- Added subagent architecture, workspace agent loading, task board service, parallel agent runner, task commands, daemon support, and daemon/parallel agent tests. (464a24b)
- Enhanced memory management and CLI functionality. (eef546a)
- Added eval and benchmark scripts, documentation, and generated coding tasks. (78f4ff4, 1b9cc88)
- Restored chat sessions and active plans across workspace reloads. (5af82f0)
- Added provider profiles, autonomy presets, onboarding, review diff features, and improved commit-message detection. (62b38ef, d651d56, 3df0628)

### Changed
- Migrated the project from npm to pnpm and added pnpm configuration. (9c6fe93, f1455d1)
- Updated README/package version metadata to 2.7.29 and synchronized generated benchmark timestamps. (e47cd01)
- Replaced native selects with custom dropdowns in the composer footer. (9ec5aff)

## [2.7.17] - 2026-07-02

### Added
- Implemented the backlog end-to-end across the repo. What changed: Added diff-first micro-task routing for commit messages, changelog entries, and release notes. Unified SCM commit message generation through the new micro-task executor. Added changelog/release generation core, VS Code commands, CHANGELOG.md, and CI release workflow. Added one-click audit pack export with zip generation, redaction report, manifest, tool audit, and approvals. Improved reasoning stream UI: live reveal, no 1200-char hard cap, configurable visibility/preview size. Added enterprise settings/docs for local-only providers, audit redaction, procurement/security/compliance. Added Windows path hardening, Windows CI matrix, and Windows smoke checklist. Added CLI MVP for changelog, prepare-release, and export-audit. Updated README with the new enterprise, audit, release, CLI, and reasoning features. Added focused tests for all new core implementations. (8a00fd537ef2)
- add AWS Bedrock, Azure OpenAI, and OpenRouter provider support (cac73bc1a9a7)
- **modes:** add pilot and enterprise depth levels to Ask, Plan, and Act modes (ca3d2daf6375)
- **orchestrator:** add planning clarification question flow with resume support (0d052937fb8e)
- auto-discover verify commands, add retry with install, cap sequential-thinking calls (6786a1d904fe)
- improve plan step UI, add skipped tool handling, and strip channel markers (d65a81752037)
- add GitHub token setting and improve issue comment pagination (7c8e53d68036)
- Implemented the core folder structure migration safely. (017ddd4d0766)
- auto-fetch GitHub issue context when user pastes an issue URL (1f0b368dfb50)
- add retrieval timing metrics, repeated tool failure guard, and Act mode MCP exclusions (dda2e8f38881)
- add Act orchestration boundary for Agent mode execution (0620f2e55902)
- **docs:** update README with enhanced project description, features, and usage instructions (920bf12f6f38)
- **plan:** add skill-aware planning pipeline with phased PlanPanel UI (e23f19d9e929)
- bundle skill playbooks inside extension and auto-install on workspace init (07a83238eb87)
- add planDepth setting and skill frontmatter parsing (d77ed8f6062f)
- **plan-mode:** add Plan mode orchestration with intent routing and read-only grounding (14372af57d12)
- **core:** add file read caching and parallelize read files tool (95dee1dbc8ac)
- **scm:** add AI-generated commit messages and ask-mode depth controls (8ea94111e43f)
- **ask:** add structured ask mode with intent routing, scope resolution, and impact analysis (aa2660f9ef3d)

### Changed
- add project-goals entry to .gitignore configuration (81ecf0da086c)
- Merge branch 'main' of https://github.com/codewithshinde/thunder-ai-agent (957469705bc4)
- **tools:** remove unused resolveToolDirPath and related imports (44a3dd3d0a8c)
