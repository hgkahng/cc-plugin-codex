---
name: claude-cancel
description: Cancel a running Claude Companion job.
---

This skill runs the Claude Companion `cancel` command.

Supported flags:

- `--job <id>`
- `--json`

Pass only the flags listed above; the script rejects unknown flags.

1. Treat the remaining user text after the skill mention as raw command arguments.
2. Set `<plugin-root>` to the directory two levels above this `SKILL.md` file. That directory holds `scripts/`, `skills/`, and `prompts/`.
3. Run `node <plugin-root>/scripts/claude-companion.mjs cancel <remaining arguments>` from the user's current workspace.
4. Return stdout verbatim.
5. If the command exits with a non-zero code, return stderr verbatim.
6. Do not do the command's work yourself.
