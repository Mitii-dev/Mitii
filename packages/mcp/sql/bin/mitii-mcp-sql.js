#!/usr/bin/env node
import { runMcpSqlServer } from '../dist/server.js';

runMcpSqlServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-sql fatal: ${message}\n`);
  process.exitCode = 1;
});
