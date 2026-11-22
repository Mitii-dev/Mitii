/**
 * Renderer → engine HTTP client barrel. Implementations live in `./api/`
 * (one module per feature); add new endpoints there, not here.
 */

export * from './api/core.js';
export { streamNdjson } from './api/http.js';
export * from './api/chat.js';
export * from './api/skills.js';
export * from './api/mcp.js';
export * from './api/recipes.js';
export * from './api/provider.js';
export * from './api/memory.js';
export * from './api/checkpoints.js';
export * from './api/profiles.js';
export * from './api/history.js';
export * from './api/indexStatus.js';
export * from './api/evidence.js';
export * from './api/workspace.js';
export * from './api/git.js';
export * from './api/util.js';
