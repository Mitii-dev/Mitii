/**
 * @mitii/host — shared host kit for Mitii apps (CLI + VS Code + Desktop + ACP).
 *
 * Dependency direction:
 *   apps → @mitii/host → @mitii/sdk → @mitii/v8
 *
 * This package owns host-side adapters and orchestration that must not live in
 * V8 or the SDK: SQLite injection, workspace indexing, durable FS stores,
 * optional SearchPort / content-aware NetworkPort (@mitii/search-kit), disk skills,
 * project rules, provider presets, and shared start-input assembly
 * (`prepareStartInput`).
 *
 * The public surface is composed from `./public/*` domain facades (re-exports
 * only). Prefer importing from `@mitii/host`; apps inject environment-specific
 * pieces (SQLite opener, secrets, settings resolution) and share the rest.
 */

export * from './public/sqlite.js';
export * from './public/indexing.js';
export * from './public/repository.js';
export * from './public/ports.js';
export * from './public/corpus.js';
export * from './public/recipes.js';
export * from './public/prompt-preview.js';
export * from './public/config.js';
export * from './public/automation.js';
export * from './public/product.js';
export * from './public/session-log.js';

// Host client composition — shared createMitiiClient wiring for every host.
export * from './client/index.js';

// Start assembly — shared MitiiStartInput for Desktop / VS Code / CLI / ACP.
export * from './start/index.js';
