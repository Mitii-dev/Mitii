#!/usr/bin/env node
import { runMcpPostgresServer } from '../dist/server.js';

runMcpPostgresServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-postgres fatal: ${message}\n`);
  process.exitCode = 1;
});
