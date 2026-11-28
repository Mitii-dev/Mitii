# Shaped discovery

Query → profile registry for early discovery (globs, searches, path ranking).

## Owns
- Profile registry + `resolveShapedDiscoveryProfile`
- Path scoring / seed selection / tool-output path extract
- Force-exploration fallback queries

## Does not own
- Discovery pass pump (`plan-discovery/runDiscoveryPass`)
- Discovery budgets (`window-budget`)
- Strategy contract (`plan-discovery/PlanDiscoveryContract`)

## Engine
`engine/.../actions/shapedDiscovery` and `modules/shaped-discovery` re-export this folder.
