# Context Assembly

`context-assembly` resolves a validated `ContextSelectionResult` into safe,
bounded, provenance-rich repository content blocks.

It answers one question:

> What repository content corresponds to the selected items, and what exact
> content can safely fit inside each allocated allowance?

## Boundary

This module:

- loads selected file, line-range, excerpt, outline, or signature content
  through registered content-source ports;
- resolves sources deterministically by priority and ID;
- applies visible representation fallbacks;
- blocks sensitive credential paths by default;
- sanitizes unsupported control characters;
- redacts common credential and secret forms;
- truncates every block to its selector-provided hard allowance;
- marks repository content as untrusted data;
- preserves selection, retrieval-source, path, range, and scoring provenance;
- validates public input, options, and output.

This module does not:

- retrieve or rank candidates;
- decide the overall model context window;
- create system, developer, or user messages;
- turn blocks into XML, Markdown, or a final prompt;
- compact conversation history;
- log, emit telemetry, retry, schedule work, or select a provider;
- authorize tools or repository changes.

Those responsibilities belong to `context-selection`, the future
`prompt-assembly`/runtime budgeting layer, and the V8 engine.

## Pipeline

```text
ContextSelectionResult + WorkspaceSnapshot
                    |
                    v
          ContextContentLoader
                    |
                    v
     SensitivePathPolicy + Sanitizer
                    |
                    v
             SecretRedactor
                    |
                    v
            ContextTextTruncator
                    |
                    v
           ContextBlockBuilder
                    |
                    v
          ContextAssemblyResult
```

## Default sources

`ContextAssemblyFactory` registers:

- `SelectedPreviewContextSource` for retrieval previews; and
- `WorkspaceFileContextSource` for full files and line-based ranges.

The engine can inject higher-priority sources for an indexed chunk store,
SQLite code index, generated outlines, symbol signatures, or remote workspace
providers. Source failure is observable even when a lower-priority source
succeeds.

## Usage

```ts
import {
  ContextAssemblyFactory,
} from "./context-assembly";

const assembler =
  new ContextAssemblyFactory().create(
    {
      fileSystem,
      additionalSources: [
        indexedChunkSource,
      ],
    },
    {
      requiredLoadFailureMode: "partial",
      sensitivePathMode: "block",
      redactSecrets: true,
      allowRepresentationFallback: true,
    },
  );

const result = await assembler.assemble({
  selection,
  snapshot,
  abortSignal,
});
```

## Untrusted-content contract

Every block has:

```ts
trust: "untrusted_repository_content"
```

Repository content can contain comments, strings, documentation, generated
text, or malicious instructions. The later prompt layer must preserve this
trust boundary and must never promote block content into system or developer
instructions.

## Hard budgets

`SelectedContextItem.allocatedTokens` is authoritative. Assembly estimates the
loaded and redacted text, then deterministically truncates it when necessary.
The output schema rejects any block whose estimate exceeds its allocation.

## Sensitive content

The default path policy blocks common credential stores such as `.env`,
`.npmrc`, private-key files, `.ssh`, and `.aws`. Safe template suffixes such as
`.example`, `.sample`, and `.template` remain readable.

When sensitive-path mode is `"redact"`, secret redaction cannot be disabled.

## Tuning

All source priorities, byte caps, fallback chains, truncation behavior,
sensitive-path rules, redaction patterns, IDs, and messages are centralized in
`constants.ts`.
