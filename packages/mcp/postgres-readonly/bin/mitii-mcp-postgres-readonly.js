#!/usr/bin/env node
import { runMcpPostgresReadonlyServer } from '../dist/server.js';

runMcpPostgresReadonlyServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-postgres-readonly fatal: ${message}\n`);
  process.exitCode = 1;
});
