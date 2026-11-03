# Contributing

Thanks for helping.

- **DCO sign-off:** by contributing, you certify the [Developer Certificate of Origin](https://developercertificate.org/). Sign off each commit with `git commit -s`, which adds a `Signed-off-by: Name <email>` line.
- **License:** contributions are accepted under Apache-2.0.
- **Branching:** work on a branch and open a PR to `main`.
- **Tests:** a change comes with its tests (`node --test`), and the suite stays green on Windows, macOS and Linux.
- **No dependencies:** Node 22.13+ built-ins only (`node:sqlite` reads OpenCode's database).
- **No secrets, no real data:** no API keys, tokens, real session logs or code from other projects. Fixtures must be synthetic.
- **Privacy first:** a new collector reads metadata only (counts, titles, timestamps), never prompts, transcripts or credentials, and says so in the README.

## Running it from a checkout

```bash
npm run check
node --test
node bin/agent-desk.mjs
```

Set `AGENT_DESK_DATA` to a scratch folder to keep your own data out of the way while testing.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Merge to `main` with CI green on all three systems.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The `release` workflow checks the tag against `package.json`, runs the suite, publishes to npm with provenance (it needs the `NPM_TOKEN` secret) and creates the GitHub release.
