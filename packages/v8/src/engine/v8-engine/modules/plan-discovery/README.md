# Plan discovery (engine shim)

Ownership lives under `runtime/helpers/plan-discovery/` (+ shaped-discovery +
window-budget). This folder re-exports for legacy engine call sites.

## Prefer
```ts
import { … } from "../../../runtime/helpers/plan-discovery";
import { resolveShapedDiscoveryProfile } from "../../../runtime/helpers/shaped-discovery";
import { resolveDiscoveryPassBudget } from "../../../modules/window-budget";
```
