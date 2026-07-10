# Telegram Connector

Start the daemon:

```bash
mitii serve --token "$MITII_SERVER_TOKEN"
```

Start the connector:

```bash
mitii connect telegram --token "$TELEGRAM_BOT_TOKEN" --daemon-url http://127.0.0.1:4310
```

Commands:

| Command | Mode |
| --- | --- |
| `/ask` | Ask mode |
| `/plan` | Plan mode |
| `/agent` | Agent mode |
| `/status` | Session status prompt |
| `/cancel` | Reserved for cancel support |

Session mapping is persisted under `~/.mitii/connectors/telegram-sessions.json`.
