# Claude Companion (lean)

Delegate tasks from Codex to your local Claude Code.

- `$claude-delegate [--background] [--model <alias>] [--effort <level>] [--resume | --fresh] <task>`
- `$claude-status`, `$claude-result --job <id>`, `$claude-cancel --job <id>`

Defaults: model `opus`, effort `high`, and a 4-hour limit per run (`CLAUDE_COMPANION_TIMEOUT_MS`). See the repository README for install and settings.
