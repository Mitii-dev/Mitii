---
name: building-components
description: Build accessible, composable, reusable UI components and component-library docs. Use for component APIs, ARIA, state patterns, design tokens, registry/npm packaging; not for full-page visual redesigns.
---

# Building Components

## Quick Reference

- Treat reusable UI as a component contract: API, states, accessibility, styling hooks, tests, and docs.
- Inspect existing component conventions before designing a new API.
- Prefer composition, controlled/uncontrolled state where appropriate, typed props, and stable data attributes.
- Load only the reference files needed for the current component concern.
- Verify with focused component tests, typecheck, lint, and accessibility checks when available.

## Scope

Use this skill when the user asks to create, refactor, document, or package reusable UI components, primitives, blocks, templates, component registries, or npm-published component packages.

Do not use this skill for a one-off full page, marketing hero, general frontend styling, backend work, or performance profiling unless the task also changes reusable component APIs.

## Procedure

1. Identify the component type: primitive, composed component, block/template, registry item, or package.
2. Read nearby components, exports, styling utilities, test setup, docs patterns, and token files before editing.
3. Define the public contract: props, variants, slots, state ownership, events, styling hooks, and accessibility behavior.
4. Implement the smallest component surface that satisfies the task; keep behavior in the component layer and avoid app-specific assumptions.
5. Add or update examples/docs only where the repository already documents components or the user requested documentation.
6. Verify with the nearest relevant checks: component/unit tests, story/example build, typecheck, lint, and accessibility assertions.

## Reference Routing

- Component taxonomy and boundaries: `references/definitions.mdx`
- Core design principles: `references/principles.mdx`
- ARIA, keyboard, focus, and WCAG: `references/accessibility.mdx`
- Slots and composition: `references/composition.mdx`
- `asChild` APIs: `references/as-child.mdx`
- Polymorphic components: `references/polymorphism.mdx`
- TypeScript prop patterns: `references/types.mdx`
- Controlled/uncontrolled state: `references/state.mdx`
- Data attributes for styling/state: `references/data-attributes.mdx`
- Token systems: `references/design-tokens.mdx`
- Styling approaches: `references/styling.mdx`
- Registry distribution: `references/registry.mdx`
- npm publishing: `references/npm.mdx`
- Marketplace packaging: `references/marketplaces.mdx`
- Component documentation: `references/docs.mdx`

## Output

For implementation tasks, report the component API changed, files touched, and verification results. For design-only answers, provide the recommended API/architecture and stop before editing unless the user asked for changes.

## Completion

Finish when the component works in its intended states, public API is typed and documented as needed, accessibility behavior is covered or manually checked, and focused verification has run or been explicitly reported as unavailable.
