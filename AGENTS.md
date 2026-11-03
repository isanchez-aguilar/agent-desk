# Quota Desk: notes for coding agents

Quota Desk is a dependency-free Node (>= 22.13) local dashboard for AI coding agents. Read `README.md`, `SECURITY.md` and `CONTRIBUTING.md` first.

- **Tests:** `npm run check` and `node --test`. They must pass on Windows, macOS and Linux. Fixtures are synthetic; never use real session logs or real data folders.
- **No dependencies.** Use Node built-ins only.
- **Privacy:** collectors read metadata (titles, counts, timestamps), never prompts, transcripts or credentials. Never read or print `.env` files, tokens or the contents of a user's data folder.
- **Security invariants** (covered by `lan.test.mjs` and `quota-desk.test.mjs`; keep them green): loopback by default; `Host` allow-list; every write needs a matching `Origin` and the per-process token; network clients in LAN mode need the access code and are read-only except quota refresh.
- **Language:** UI, docs, code and commits in English.
- **Git:** work on a branch, never on `main`. Commit with a noreply email, not a personal one. Publishing to npm and merging are maintainer actions (see `CONTRIBUTING.md`).
- **Relayrace contract:** the `projects` format in `config.json` is shared with Relayrace AI; changing it needs a matching change there.
