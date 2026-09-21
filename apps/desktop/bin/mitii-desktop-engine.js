#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(here, '..', 'dist', 'engine', 'main.js')).href);
