# Code Navigation

**Does:** resolve definitions, references, hover, symbols, implementations, and call hierarchy via an injected `CodeNavigationPort`. Does not spawn language servers or own repository indexing.

## Layout

```text
actions/    Pipeline + steps (what the module does)
helpers/    shared help for actions only
ports/      CodeNavigationPort (promise only)
impl/   graph/ + fallback/ method files (fulfill the port)
types/      input / output / errors
rules/      caps / hop depth
```

## Contract

```text
CodeNavigationInput + CodeNavigationPort
  → CodeNavigationPipeline.navigate()
  → CodeNavigationResult
```

## Example

```ts
const result = await new CodeNavigationPipeline({
  navigation: hostPort,
}).navigate({
  schemaVersion: 1,
  operation: "definition",
  query: {
    relativePath: "src/auth.ts",
    line: 4,
    column: 10,
    symbolName: "validateJwt",
  },
  maximumLocations: 40,
});
```
