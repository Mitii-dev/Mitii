# Store + StoreManager

| Name | Job |
|---|---|
| **Store** | Live data box for one `runId` |
| **StoreManager** | Only clerk: get/set slices, cancel, packTurn, snapshot/hydrate |

Flow and settle must not poke Store fields directly. Suspend embeds `storeSnapshot` in the gate checkpoint; resume hydrates before re-drive.
