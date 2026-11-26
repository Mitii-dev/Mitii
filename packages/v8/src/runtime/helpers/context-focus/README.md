# Context focus

Derive file/folder focus from understanding + prior path hints, and score
whether a retrieved path is relevant to the ask.

## Owns
- `deriveContextFocusFromUnderstanding` / merge with prior hints
- Context-ready warning code sets + path canonicalization
- File-context relevance scoring
- Understanding candidate path collection (dirty/diagnostic/@refs)

## Does not own
- Full ContextBundle enrich pipeline (`helpers/enrich`)
- Planning preferred seed paths (`helpers/plan-discovery`)
