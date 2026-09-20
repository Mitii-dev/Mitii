# Mitii — Copyright, authorship & inspiration notice

**Copyright (C) 2025–2026 codewithshinde \<codewithshinde@gmail.com\>**

Mitii (including the Mitii AI Agent monorepo, `@mitii/*` packages, apps, schemas,
prompts, branding, and documentation authored in this repository) is the
**original work** of **codewithshinde**, written and driven solely by
codewithshinde.

This file is the **canonical** place for (1) authorship / ownership statements
and (2) courtesy acknowledgements of *independent prior art* that may have
*inspired* Mitii design decisions. Do **not** restate third-party product names
in source comments.

---

## 1. Ownership and license of Mitii

1. **Sole authorship.** Mitii’s source code, TypeScript modules, contracts,
   schemas (`mitii.*`), bundled rules, prompts, UI, and Mitii-authored docs in
   this repository were created by codewithshinde. No other person or
   organization is a joint author of Mitii by virtue of being listed below.
2. **Copyright.** Copyright in Mitii is held by **codewithshinde**.
3. **Outbound license.** Mitii is licensed to the public under the
   **GNU Affero General Public License v3.0 or later** (`LICENSE`). Rights to
   use, modify, and redistribute Mitii come **only** from that AGPL grant (or a
   separate commercial license from codewithshinde), not from any third party
   named in this notice.
4. **No third-party ownership of Mitii.** Projects, companies, or individuals
   named below (or any “coding agent” / review tool generally) do **not**:
   - own copyright in Mitii;
   - co-author Mitii;
   - hold a license *to claim Mitii as their work*;
   - hold a trademark, patent, or other IP right that is assigned or granted
     *into* Mitii by this notice; or
   - have standing under this notice to assert that Mitii is a copy, fork,
     port, or official product of theirs.
5. **Commercial licensing.** Contact codewithshinde for licensing outside AGPL
   terms. Only codewithshinde may grant such licenses for Mitii.

---

## 2. Inspiration only — not copied, not vendored, not derivative

The sections below are **courtesy acknowledgements of inspiration**.

| What Mitii did | What Mitii did **not** do |
|---|---|
| Studied public ideas, UX patterns, and high-level algorithms | Copy, paste, or vendor third-party agent source trees |
| Independently reimplemented behavior under Mitii contracts | Ship upstream prompts, rule corpora, or Go/Rust/Python agent code as Mitii |
| Kept Mitii schemas, branding, and APIs | Create a fork, port, or “compatible rebrand” of those products |

**Legal effect of “inspired by”:**

- Inspiration of *ideas*, *methods*, or *design patterns* does **not** transfer
  copyright in Mitii to the inspired-from project.
- Copyright protects *particular expression* (source code, docs, assets), not
  abstract ideas or functional goals. Mitii’s expression is original Mitii code.
- Listing a project here is **not** an admission that Mitii is a *derivative
  work* of that project under copyright law.
- Listing a project here does **not** incorporate that project’s license into
  Mitii, does **not** create joint authorship, and does **not** give that
  project’s authors any ownership or claim over Mitii’s codebase.
- Those projects retain copyright in **their own** repositories under **their
  own** licenses. Mitii users who want those projects must obtain them from
  their upstream sources — not from this repository.

**No extra third-party LICENSE appendices are required for the inspirations
below**, because Mitii does **not** distribute their source code. (Separate
npm/runtime dependencies of Mitii remain under *their* package licenses as
declared by those packages — that is ordinary dependency licensing, unrelated
to the agent/review inspirations listed here.)

---

## 3. Courtesy inspirations (independent prior art)

### 3.1 Open Code Review (Apache-2.0)

**Inspiration only.** High-level review workflow ideas (file selection,
grouping, path-matched rules, anchoring, SARIF-oriented output) informed
Mitii’s structured review module (`packages/v8/src/modules/review/`).

- Upstream (for reference only):
  [alibaba/open-code-review](https://github.com/alibaba/open-code-review)
- Mitii does **not** vendor that project’s Go sources, embedded rule corpora,
  or prompt templates.
- See also: `docs/architecture/ADR-review-module.md`.

### 3.2 Coding-agent planning & prompt formulae (industry practice)

**Inspiration only.** Mitii’s planning step-shape, discovery quality floors,
strategy contracts, and typed prompt-fragment caps follow *industry coding-agent
practice* of the same general class as publicly discussed Codex- / VT Code–style
agent runtimes.

- No third-party agent repository is vendored.
- No upstream agent license is incorporated into Mitii by this acknowledgement.
- Mitii’s planning and prompt-construction modules are original Mitii code.

### 3.3 Aider (MIT / Apache-2.0 as applicable to *Aider’s* own tree)

**Inspiration only.** Public ideas around symbol/call-oriented repo ranking,
tags-style capture *conventions*, and edit-retry hint ladders informed Mitii
repository-intelligence and mutation *hint* design:

- Tree-sitter query *approach* under
  `packages/v8/src/modules/repository-state/internal/source-analysis/queries/`
- Repo-map ranking personalization under
  `packages/v8/src/modules/repository-state/internal/repo-map/ranking/`
- Edit-format repair *hints* under
  `packages/v8/src/engine/tool-runtime/internal/mutation/editFormatRepairHints.ts`

- Upstream (for reference only):
  [Aider-AI/aider](https://github.com/Aider-AI/aider)
- Mitii does **not** ship Aider’s application source. Mitii owns its parsers,
  ranking, and mutation pipelines. Legacy capture-name *compatibility* (if any)
  exists only so host runtimes can accept common query styles — it is not a
  grant of Aider ownership over Mitii.

---

## 4. Claims and disputes

1. **No warranty of non-infringement is created by silence.** This notice
   states Mitii’s authorship and that listed inspirations were not copied into
   this repository as those projects’ source.
2. **No license from inspirations.** Nothing in this file is a license *from*
   Alibaba, OpenAI, Anysphere, Aider-AI, or any other third party *to* Mitii
   users for Mitii code — Mitii is licensed under AGPL (or a commercial grant
   from codewithshinde).
3. **No license *to* claim Mitii.** Nothing in this file grants any third party
   the right to claim authorship, co-ownership, or product identity of Mitii.
4. **Contact.** Copyright and licensing inquiries:
   **codewithshinde \<codewithshinde@gmail.com\>**.

---

## 5. Document control

| Field | Value |
|---|---|
| Document | `NOTICE-REVIEW.md` |
| Role | Authorship + inspiration acknowledgements (not a software license) |
| Governing license of Mitii | `LICENSE` (AGPL-3.0-or-later) |
| Author / copyright holder | codewithshinde |
| Last updated | 2026-09-20 |
