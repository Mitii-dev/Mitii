# Changelog

## [Unreleased]

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
