---
name: browser-testing-with-devtools
description: >-
  Browser automation and UI verification with Puppeteer MCP for React, Next.js, and web apps.
  Use for screenshots, DOM assertions, and smoke-testing pages after UI changes.
---

# Browser Testing with Puppeteer

## Quick Reference

- Use for UI smoke checks, screenshots, and client-side flow verification.
- Prefer Mitii-preloaded Puppeteer MCP when enabled.
- Keep runs bounded: one page/flow, explicit selectors, clear pass/fail.
- Pair with `test-driven-development` for behavior changes that need unit tests too.

## When to Use

- React / Next.js / Vite UI verification after Agent edits
- Screenshot or DOM assertions
- Smoke-testing pages in benchmarks or CI fixtures

## When Not to Use

- Pure backend/API work with no UI surface
- Accessibility audits that need specialized tooling beyond smoke checks

## MCP Setup

Mitii preloads `@modelcontextprotocol/server-puppeteer` when `mitii.mcp.builtinServers.puppeteer` is enabled.

Headless CLI:

```bash
mitii agent "Open the home page and verify the title" --runtime real --enable-puppeteer --approval auto
```

## Workflow

1. Confirm the app is reachable (dev server URL or static path).
2. Navigate to the target route.
3. Assert title/DOM/screenshot against the acceptance criteria.
4. Report pass/fail with the evidence collected.
5. On failure, capture console errors and a screenshot before debugging code.
