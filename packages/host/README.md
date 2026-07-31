# @mitii/host

Shared host kit for Mitii apps (VS Code + CLI):

- Full workspace indexing (SQLite + optional LanceDB embeddings)
- Host repository-context wiring
- Durable `.mitii/checkpoints` helper
- OpenAI-compatible provider presets

Hosts inject their SQLite opener (`openDatabase`) so Electron-native bindings stay in the VS Code app.
