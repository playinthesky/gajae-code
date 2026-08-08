@AGENTS.md

## Why this file exists

Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Without the import above, every
rule in `AGENTS.md` was invisible to Claude Code sessions — the agent contract,
the workflow routing, the testing rules, all of it.

`AGENTS.md` stays the single source of truth. Do not copy rules into this file;
edit `AGENTS.md` instead. This file only makes them load.

Subdirectory contracts load the same way: `python/robogjc/CLAUDE.md` imports
`python/robogjc/AGENTS.md`, and Claude Code pulls it in when it reads files in
that directory.
