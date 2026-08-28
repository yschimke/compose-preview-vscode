# Daemon protocol fixtures — vendored

These are a **verbatim copy** of `docs/daemon/protocol-fixtures/` in
[yschimke/compose-ai-tools](https://github.com/yschimke/compose-ai-tools). They are
not authored here. `UPSTREAM_README.md` is that directory's own README, kept for
the format documentation.

## Why they are vendored, and what stops them rotting

Both the Kotlin daemon suite and this repo's TypeScript suite parse the same files.
That shared parse is the drift check: a fixture added or reshaped on one side
without the other is a protocol change one ecosystem has not seen. In the monorepo
that check was free — one checkout, one copy, impossible to skew.

Split apart it is not free, and copying the files without more would convert a
guarantee into a stale snapshot nobody notices. So the copy is paired with the
`Protocol Fixtures` workflow, which fetches this directory from upstream at the tag
matching the `composeAiPlugin` pin in `plugin-version.json` and fails on **any**
difference — content, additions, or deletions.

That makes the vendored copy a *pinned* one rather than a forked one: it is allowed
to differ from upstream `main` (this repo tracks a released plugin, not the tip),
but it may never differ from the release it claims to speak to.

## Updating

Do not hand-edit these files. Bump `composeAiPlugin` in `plugin-version.json`, then:

```sh
scripts/sync-protocol-fixtures.sh
```

Commit the pin bump and the refreshed fixtures together — the workflow checks them
against each other, so a bump without a sync (or a sync without a bump) goes red.
