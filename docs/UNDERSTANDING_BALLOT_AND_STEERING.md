# Understanding Ballot and Decision Steering

Status: in-tree roadmap (Phases 0–4)  
Audience: V8 contributors and hosts

## Principles

1. **Authority stays in code.** Decision Policy owns route and grant. Tool Runtime enforces. Skills never grant tools. The LLM never widens grants.
2. **LLM = constrained multiple choice** over messy user language (intent catalog, situation slots, closed skill tags) — not freeform policy.
3. **One understanding LLM call** pays for intent, situation clarify options, targets, and soft skill tags. No separate skills LLM.
4. **Fail closed.** LLM failure falls back to the rule/ensemble path. Never invent execute authority from a failed ballot.
5. **Monotonic safety.** DecisionBrief, critic, and tags may only narrow, boost, or pause — never add tools, hosts, or path breadth.

## Layer contracts

| Layer | Owns | Must not |
|---|---|---|
| Understanding ballot | Facts: interaction, task intent, targets, ambiguous slots, soft skill tags | Routes, tool grants, skill IDs as authority |
| Clarification options | Typed slots with stable namespaced ids | Grant changes by themselves |
| Decision Policy | Route, planning depth, plan gate, tool grant, verification | Trusting raw English over high-confidence facts when facts-first is on |
| Skills | Rank/budget playbooks using soft tags | Selecting from tags alone; granting tools |
| DecisionBrief | Worker-facing mission/constraints from the decision | Changing route or grant |
| Pre-mutation critic | `pass` / `revise` / `stop_and_clarify`; may narrow or pause | Widening the grant |

## Clarification option ids

Namespaced, stable ids (examples):

- `intent:bugfix`
- `interaction:question` | `interaction:plan` | `interaction:act`
- `target:src/LoginForm.tsx`
- `scope:one_file` | `scope:module` | `scope:repo`
- `outcome:<slug>`

Resume maps a chosen option id to a structured fact patch, then re-runs understand + decide. Free-text answers still append prose only.

## Soft skill tags

`recommendedSkillTags` are intersected with a closed vocabulary (catalog tags + engine priors such as `localize`, `fix`). Unknown tags are dropped. Tags boost Skills ranking only; they never grant applicability alone.

## Feature flags (`steering` on Agent Engine start input)

| Flag | Default | Effect |
|---|---|---|
| `understandingBallotV2` | `false` | Situation slots in clarify UX, closed-tag intersect, structured option resume |
| `policyFactsFirst` | `false` | Prefer high-confidence understanding over `looksLike*` except safety overrides |
| `decisionBrief` | `false` | Inject deterministic DecisionBrief into the system prompt |
| `criticMode` | `"off"` | `"shadow"` logs only; `"enforce"` may narrow/pause before mutation |

## Related code

- Request Understanding intent ballot: `packages/v8/src/modules/request-understanding/intent/`
- Decision Policy: `packages/v8/src/modules/decision-policy/`
- DecisionBrief: `packages/v8/src/modules/decision-policy/actions/CompileDecisionBrief.ts`
- Critic: `packages/v8/src/engine/agent-engine/actions/evaluateMutationCritic.ts`
- Skills soft tags: `packages/v8/src/modules/skills/actions/MatchSkills.ts`
