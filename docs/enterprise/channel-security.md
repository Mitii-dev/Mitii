# Channel Security

Channel connectors route Slack, Telegram, Discord, and similar messages into the daemon. Treat them as external ingress.

Baseline controls:

| Control | Mitii behavior |
| --- | --- |
| User allowlist | Connectors can reject users not present in `allowedUsers`. |
| Thread allowlist | Connectors can restrict use to approved channel/thread IDs. |
| Read-only mode | Channel policy can downgrade `agent` requests to `plan`. |
| Secret redaction | Long token-like values are redacted from outbound replies. |
| Auditability | Channel prompts flow through daemon sessions and session logs. |

Enterprise deployments should keep connectors bound to loopback daemons or require `MITII_SERVER_TOKEN` for non-loopback hosts.
