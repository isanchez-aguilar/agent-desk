# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting: **Security → Report a vulnerability** on the repository page. You will
get an answer within a few days, and a fix or a mitigation plan before details
are made public.

## Supported versions

Only the latest release (`0.x`) receives fixes.

## What Agent Desk does and does not do

Agent Desk reads usage data that your agents already keep on your machine and
shows it in a local web page. It is built to keep that bounded:

- **No dependencies** and no network access of its own. The only programs it
  starts are the Codex app server (`codex app-server`, to call
  `account/rateLimits/read`), Antigravity's `agy -p /usage` in plan mode, and
  `git worktree list` in the project folders you add. The executable paths come
  from `config.json`, never from a request.
- **Read-only towards your agents.** The Codex client refuses any method other
  than the two quota reads; it never starts a conversation, logs in, or spends a
  reset. The OpenCode database is opened read-only and only numeric usage columns
  are selected. Prompts, transcripts, source files and credentials are not copied:
  only titles, a first-request excerpt of at most 240 characters with known
  credential patterns redacted, models, branches, timestamps and token counts.
- **Loopback by default.** The server listens on `127.0.0.1` and answers only when
  the `Host` header is `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS
  rebinding. Every write needs a matching `Origin` and a random per-process token.
  Responses carry a strict Content-Security-Policy, and only the three files in
  `public/` are served.
- **Project folders are local only.** Network (UNC) and device paths, and folders
  whose real path is a network share (a mapped drive, or a link to a share), are
  refused when you add a project and skipped when they appear in `config.json`
  or as a Git worktree of a project.

## LAN mode

LAN mode is **off** unless you set `"lan": true` in `config.json`. When it is on:

- The server listens on all interfaces, and accepts a `Host` header only when it
  is a private IPv4 literal (10/8, 172.16/12, 192.168/16) with the right port.
  DNS names are always refused.
- Every client other than this computer must enter an access code (`XXXX-XXXX`,
  stored in `lan-code` in the data folder). Five wrong codes per minute per
  address lock that address out for the rest of the minute. A correct code gives
  an `HttpOnly`, `SameSite=Strict` cookie valid for 30 days or until the server
  restarts.
- **Network clients are read-only.** They can view the panel, export it and ask
  for a quota refresh (at most one query a minute). Adding records, notes,
  projects or manual quotas is refused with `403`.
- It is plain HTTP. The code and the cookie cross your network unencrypted, so
  anyone who can watch that network can capture them and read the panel. Use LAN
  mode only on a network you control, never on public or shared Wi-Fi. Prefer an
  SSH tunnel (see the README) when in doubt.
- Connections from this computer, including through an SSH tunnel or a local
  reverse proxy, count as local: they need no code and can write. Do not put a
  proxy that forwards outside traffic in front of Agent Desk.

What a signed-in network client can see: quota readings, session titles and
first-request excerpts, models, branches, token counts, your manual records and
notes, and the names and **absolute paths** of your projects.

Report anything that makes Agent Desk do more than this.
