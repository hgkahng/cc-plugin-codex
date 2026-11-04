---
name: claude-delegate
description: Delegate an implementation or investigation task to Claude.
---

This skill runs the Claude Companion `delegate` command.

Supported flags:

- `--model <alias>`
- `--effort <level>`
- `--background`
- `--resume`
- `--fresh`
- `--json`

Pass only the flags listed above, placed before the task text. Never add Claude Code CLI flags such as `--dangerously-skip-permissions`. The script builds the `claude` command itself and rejects unknown flags.

This command runs the user's local Claude Code under the user's own Anthropic account. It sends Anthropic the same data as the user running `claude` in a terminal in this workspace.

1. Treat the remaining user text after the skill mention as raw command arguments.
2. Set `<plugin-root>` to the directory two levels above this `SKILL.md` file. That directory holds `scripts/`, `skills/`, and `prompts/`.
3. Run `node <plugin-root>/scripts/claude-companion.mjs delegate <remaining arguments>` from the user's current workspace.
4. Return stdout verbatim.
5. If the command exits with a non-zero code, return stderr verbatim.
6. Do not do the command's work yourself.
