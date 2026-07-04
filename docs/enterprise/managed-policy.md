# Managed Enterprise Policy

Mitii can be governed with a managed `.mitii/mitii.policy.json` file distributed by MDM, base images, or repository templates. Policy values are intentionally coarse and override user-facing convenience features before a connector, worker, or team runtime starts.

```json
{
  "localProvidersOnly": true,
  "channelsDisabled": false,
  "maxParallel": 10,
  "autoPrEnabled": false,
  "stripFileContentsFromAuditPacks": true,
  "allowedChannelUsers": [],
  "allowedChannelThreads": []
}
```

Recommended controls:

| Policy | Purpose |
| --- | --- |
| `localProvidersOnly` | Require local or approved private model providers. |
| `channelsDisabled` | Disable Slack, Telegram, Discord, and similar external surfaces. |
| `maxParallel` | Cap parallel sessions, workers, and teammates. |
| `autoPrEnabled` | Keep PR creation explicit unless centrally approved. |
| `stripFileContentsFromAuditPacks` | Preserve audit metadata while reducing data exposure. |

Phase 3 treats this as the stable policy contract. Future SSO/OIDC and HA daemon work should extend this file instead of introducing a second policy surface.
