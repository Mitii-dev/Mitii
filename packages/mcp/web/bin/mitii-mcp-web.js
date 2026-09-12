#!/usr/bin/env node
import { runMcpWebServer } from '../dist/server.js';

runMcpWebServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mitii-mcp-web fatal: ${message}\n`);
  process.exitCode = 1;
});
