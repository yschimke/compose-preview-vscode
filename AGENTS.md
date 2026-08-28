# AGENTS.md

The VS Code extension for [Compose Preview](https://github.com/yschimke/compose-ai-tools).
This repository is **only** the extension: TypeScript, its webview, its Playwright
harness and its fixtures. The Gradle plugin, the CLI, the daemon and the renderers
live in [`yschimke/compose-ai-tools`](https://github.com/yschimke/compose-ai-tools),
which this repo consumes as a **published artifact**.

## The one rule that is different here

**This repo cannot build the plugin it depends on.** That is the whole point of the
split ([compose-ai-tools#4732](https://github.com/yschimke/compose-ai-tools/issues/4732)),
and almost every gotcha below follows from it.

`plugin-version.json` pins the plugin coordinate the extension injects into a user's
build (`composeAiPlugin`). It is a compatibility assertion about *another repository's
releases*, so:

- **Bump it in its own PR.** Adopting a new plugin release is a reviewable change, not
  a side effect of a release train. In the monorepo the version came from
  `.release-please-manifest.json` and moved on its own; nothing moves it here.
- **The committed pin must be a release, never a `-SNAPSHOT`.** The `Plugin Pin`
  workflow rejects a SNAPSHOT and fails if the pinned version does not resolve on
  Maven Central.
- **Use `PLUGIN_VERSION` for local SNAPSHOT loops** against a `publishToMavenLocal`
  from a compose-ai-tools checkout. `scripts/generate-version.mjs` honours it, and
  `initScript.ts` turns mavenLocal on automatically for any `-SNAPSHOT` coordinate.

## Commands

```sh
npm ci
npm run compile          # host + webview; regenerates src/version.generated.ts
npm test                 # mocha unit/integration
npm run test:electron    # VS Code integration tests (xvfb-run -a … on Linux)
npm run format           # prettier, --tab-width 4; format:check is a CI gate
npm run package          # vsce package
```

Harness (Playwright, captures into `preview-harness/out/`):

```sh
npm run harness:contract   # assert each fixture's expectedPosts
npm run harness:snapshot   # page captures
```

Run the formatter before committing — `npm run format:check` is a hard CI gate.

`package.json` still carries a `lint` script, but there is no ESLint config and no
`eslint` dependency: it was already dead in the monorepo (CI never invoked it) and
came across as-is rather than being silently deleted during the migration. Either
wire up ESLint properly or drop the script — don't add it to CI expecting it to work.

## What is NOT here, and where it went

| You are looking for | It is in |
| --- | --- |
| Gradle plugin, CLI, daemon, renderers | [`compose-ai-tools`](https://github.com/yschimke/compose-ai-tools) |
| `compose-preview serve` and its harness | `compose-ai-tools`, `preview-server/preview-harness/` |
| The `:samples:*` (mavenLocal) e2e suite | `compose-ai-tools` — it tests a plugin only that repo can build |
| Consumer skill docs | [`yschimke/skills`](https://github.com/yschimke/skills) |

Two generators still need a compose-ai-tools checkout, and **only to regenerate** —
their outputs are committed, so CI and the harness never need it:

- `preview-harness/fixtures/a11y-wear.gen.mjs` — set `WEAR_SAMPLE_RENDERS` to a
  checkout's `samples/wear/build/compose-previews/renders`.
- `preview-harness/fixtures/spatial-xr-real.gen.mjs` — needs a real XR render.

## Vendored protocol fixtures

`protocol-fixtures/` is a **copy** of `docs/daemon/protocol-fixtures/` from upstream,
at the release the pin names. Do not hand-edit it. Bump the pin, then run
`scripts/sync-protocol-fixtures.sh`, and commit both together — the `Protocol
Fixtures` workflow checks them against each other and fails on any difference.

## Testing posture

`npm run test:e2e-external` is the extension's end-to-end suite. It drives a real
third-party Compose Multiplatform consumer (Confetti) that resolves the plugin **from
Maven Central**, which is the only path this repo can honestly test. It runs nightly
rather than on every PR, because it tracks upstream `main` and can go red without
anything here changing.

## Conventional commits

Commit subjects and PR titles use conventional-commit prefixes (`fix:`, `feat:`,
`docs:`, `test:`, `ci:`, …), matching the upstream repo's convention.
