#!/usr/bin/env node
import { runMcpSqliteReadonlyServer } from '../dist/server.js';

runMcpSqliteReadonlyServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-sqlite-readonly fatal: ${message}\n`);
  process.exitCode = 1;
});
