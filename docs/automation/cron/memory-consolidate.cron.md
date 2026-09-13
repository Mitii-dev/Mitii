---
name: memory-consolidate
cron: "0 3 * * 0"
timezone: UTC
mode: ask
autonomyPreset: readonly
enabled: false
---

Weekly memory consolidate (enable when ready):

Run MemoryPipeline.consolidate for this workspace scope to merge
whitespace-normalized near-duplicate facts and supersede older copies.

Host recipe: `@mitii/host` documents `MEMORY_CONSOLIDATE_SCHEDULE_PROMPT`.
Reply with consolidate counts only — do not edit repository files.
