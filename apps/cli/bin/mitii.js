#!/usr/bin/env node
import { main } from '../dist/cli.js';

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mitii: ${message}\n`);
    process.exit(1);
  });
