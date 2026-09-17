# Daemon protocol fixtures — vendored

These are a **verbatim copy** of `docs/daemon/protocol-fixtures/` in
[yschimke/compose-preview-daemon](https://github.com/yschimke/compose-preview-daemon).
They are not authored here. `UPSTREAM_README.md` is that directory's own README, kept
for the format documentation.

They used to come from `yschimke/compose-ai-tools`, and the fixture bytes did not
change when they moved — only their home did. compose-ai-tools extracted the daemon,
the renderers, the preview annotations and the data extractors into that repository,
on its own 3.x release train, so the files describing the daemon wire went with the
daemon and the plugin's version stopped naming a tag that contains them.

## Why they are vendored, and what stops them rotting

Both the Kotlin daemon suite and this repo's TypeScript suite parse the same files.
That shared parse is the drift check: a fixture added or reshaped on one side
without the other is a protocol change one ecosystem has not seen. In the monorepo
that check was free — one checkout, one copy, impossible to skew.

Split apart it is not free, and copying the files without more would convert a
guarantee into a stale snapshot nobody notices. So the copy is paired with the
`Protocol Fixtures` workflow, which fetches this directory from upstream at the tag
matching the `composePreviewDaemon` pin in `plugin-version.json` and fails on **any**
difference — content, additions, or deletions.

That makes the vendored copy a *pinned* one rather than a forked one: it is allowed
to differ from upstream `main` (this repo tracks a released plugin, not the tip),
but it may never differ from the release it claims to speak to.

## Updating

Do not hand-edit these files. The fixture source is the `composePreviewDaemon` pin,
which is **derived** from `composeAiPlugin` rather than chosen next to it: it must be
the daemon release the pinned plugin resolves. `scripts/check-daemon-pin.mjs` reads
that back out of the plugin's published POM on Maven Central and fails if the two have
skewed, so the sequence when adopting a new plugin is:

```sh
# 1. bump composeAiPlugin in plugin-version.json
node scripts/check-daemon-pin.mjs        # tells you the daemon version it now resolves
# 2. set composePreviewDaemon to that
scripts/sync-protocol-fixtures.sh
```

Commit the pin bumps and the refreshed fixtures together — the workflow checks them
against each other, so a bump without a sync (or a sync without a bump) goes red.
