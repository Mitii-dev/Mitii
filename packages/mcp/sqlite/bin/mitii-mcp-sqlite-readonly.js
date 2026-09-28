#!/usr/bin/env node
import { runMcpSqliteServer } from '../dist/server.js';

runMcpSqliteServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-sqlite fatal: ${message}\n`);
  process.exitCode = 1;
});
