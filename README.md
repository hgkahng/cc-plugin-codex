# CC Plugin Codex (lean fork)

Delegate tasks from Codex to your local Claude Code.

This is a trimmed fork of [`pejmanjohn/cc-plugin-codex`](https://github.com/pejmanjohn/cc-plugin-codex). It keeps delegation and background jobs, removes the review, rescue, and setup skills, and raises the run time limit from 30 minutes to 4 hours.

## Skills

| Skill | Use |
|---|---|
| `$claude-delegate` | Send a task to Claude Code, in the foreground or with `--background` |
| `$claude-status` | List jobs for the current workspace |
| `$claude-result --job <id>` | Print a job's stored output |
| `$claude-cancel --job <id>` | Stop a running background job |

## Requirements

- Codex with plugin support, and `codex` on `PATH`
- Claude Code installed and signed in, as `claude`
- Node.js 18.18 or later

## Install

```bash
codex plugin marketplace add hgkahng/cc-plugin-codex
codex plugin add claude-companion@cc-plugin-codex-marketplace
```

Restart Codex (or the Codex app), then start a new thread.

To update, run `codex plugin marketplace upgrade cc-plugin-codex-marketplace`, repeat `codex plugin add`, and start a new thread. To uninstall, run `codex plugin remove claude-companion@cc-plugin-codex-marketplace` and `codex plugin marketplace remove cc-plugin-codex-marketplace`.

## Delegate

```text
$claude-delegate investigate the flaky checkout test
$claude-delegate --background --effort xhigh implement the retry fix
$claude-delegate --resume now add a test for it
```

| Flag | Effect |
|---|---|
| `--background` | Return a job id at once; check it with `$claude-status` and `$claude-result` |
| `--model <alias>` | Claude model, such as `opus` (default) or `sonnet` |
| `--effort <level>` | `low`, `medium`, `high` (default), `xhigh`, or `max` |
| `--resume` | Continue the latest Claude session started from this Codex thread |
| `--fresh` | Start a new Claude session |
| `--json` | Print the full job record as JSON |

Use `--background` for long tasks, so Codex does not wait on one long shell command.

Each run is `claude -p --output-format json` in the current workspace. Claude loads your usual setup (CLAUDE.md, skills, plugins, MCP servers) and uses your Claude Code permission settings. With no `permissions.defaultMode` set, a `claude -p` run denies anything that needs approval, so Claude can read files but not edit them.

## Settings

| Setting | Where | Default |
|---|---|---|
| Run time limit | `CLAUDE_COMPANION_TIMEOUT_MS` environment variable | 4 hours |
| Default model and effort | `~/.codex/claude-companion/config.json`, for example `{"defaultModel": "sonnet", "defaultEffort": "medium"}` | `opus`, `high` |
| Job records and output | `~/.codex/claude-companion/workspaces/` (or `CLAUDE_COMPANION_STATE_ROOT`) | |

## If Codex blocks the delegate command

Codex may refuse to run it as "delegating repository context to an external service". The command runs your own `claude` under your own Anthropic account, the same as running `claude` in a terminal. The decision belongs to Codex's approval layer. The plugin rejects unknown flags, so a command where Codex added a flag such as `--dangerously-skip-permissions` fails; retry the skill.

## Development

```bash
npm ci
npm run test:claude
```

To test a local checkout, add it as the marketplace instead: `codex plugin marketplace add /path/to/cc-plugin-codex`.
