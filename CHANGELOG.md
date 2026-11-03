# Changelog

All notable changes. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.1.0] - Unreleased

First public release.

### Added

- Local dashboard on `http://127.0.0.1:4318`: quotas, recent sessions, token counts, relay hand-offs and a manual work log, in English.
- Quota readers for Codex (official app server, read-only), Antigravity (`/usage` in plan mode) and Claude Code (official status-line input via `agent-desk capture`); manual readings for Jules and ChatGPT.
- Session metadata from Claude Code and Codex logs, OpenCode's local Qwen usage, and Relayrace runs (`.ai/runs`) in your projects and their worktrees.
- `agent-desk` command for Windows, macOS and Linux: start the panel, `record`, `capture`, `data`.
- Data folder outside the package: `AGENT_DESK_DATA`, else `~/.agent-desk` (an existing `data/` folder next to the code keeps working).
- Opt-in LAN mode with an access code, private-IP `Host` check, rate limiting, and read-only access for network clients.
- `config.json` `projects` format shared with [Relayrace AI](https://github.com/isanchez-aguilar/relayrace-ai).

### Security

- Project folders on network (UNC) or device paths are refused and skipped.
