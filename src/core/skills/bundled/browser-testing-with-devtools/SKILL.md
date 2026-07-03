---
name: browser-testing-with-devtools
description: Browser automation and UI verification with Puppeteer MCP for React, Next.js, and web apps.
---

# Browser testing with Puppeteer

Use this skill when validating UI behavior, screenshots, or client-side flows in JavaScript web apps.

## When to use

- React / Next.js / Vite UI verification
- Screenshot or DOM assertions after Agent edits
- Smoke-testing pages in benchmark or CI fixtures

## MCP setup

Mitii preloads `@modelcontextprotocol/server-puppeteer` when `thunder.mcp.builtinServers.puppeteer` is enabled.

Headless CLI:

```bash
mitii agent "Open the home page and verify the title" --runtime real --enable-puppeteer --approval auto
```

## Tools

- `mcp__puppeteer__puppeteer_navigate`
- `mcp__puppeteer__puppeteer_screenshot`
- `mcp__puppeteer__puppeteer_click`
- `mcp__puppeteer__puppeteer_fill`
- `mcp__puppeteer__puppeteer_evaluate`

## Workflow

1. Start or assume a local dev server (`npm run dev`) when testing a fixture repo.
2. Navigate to the page under test.
3. Capture screenshot or evaluate DOM selectors.
4. Report pass/fail with evidence in the session log.
