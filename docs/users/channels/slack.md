# Slack Connector

Slack support uses the same channel runtime contract as Telegram: channel/thread IDs map to daemon sessions, user IDs can be allowlisted, and outbound messages are redacted before posting.

Phase 3 ships the channel architecture and Telegram polling connector first. Slack Socket Mode should use the same `ChannelRuntimeAdapter` with thread timestamp to session mapping and approval buttons for tool calls.
