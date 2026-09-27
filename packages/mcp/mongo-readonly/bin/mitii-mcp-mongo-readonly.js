#!/usr/bin/env node
import { runMcpMongoReadonlyServer } from '../dist/server.js';

runMcpMongoReadonlyServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-mongo-readonly fatal: ${message}\n`);
  process.exitCode = 1;
});
