#!/usr/bin/env node
import { runMcpMongoServer } from '../dist/server.js';

runMcpMongoServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-mongo fatal: ${message}\n`);
  process.exitCode = 1;
});
