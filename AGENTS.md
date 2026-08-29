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

## Visual evidence

A change that can move the panel's pixels gets a before/after table on its PR
automatically: `preview-comment.yml` renders every `preview-harness` fixture ×
dark/light, diffs it against the baselines on `preview/main`, and posts a sticky
comment. `preview-baselines.yml` republishes `preview/main` on every merge.

- **The harness runs there, not in `ci.yml`.** Running it in both would pay for
  Chromium and the whole fixture sweep twice per PR.
- **The diff is perceptual, not byte-exact.** Chromium's rasterisation is not
  bitwise-deterministic between runs, so pixelmatch (AA-aware) filters the ±1-channel
  edge jitter. Without that filter every PR shows fake "changed" rows.
- **A new surface needs a fixture** in `preview-harness/fixtures/`, or the next change
  to it is invisible to the diff.
- `harness:contract` runs alongside the captures and catches what pixels cannot — e.g.
  a chip that stops posting `setDataExtensionEnabled` moves nothing visually.

This machinery is a **copy** of the pipeline in yschimke/compose-ai-tools, which still
diffs the `compose-preview serve` page captures with the same script. Copied rather
than shared: the two repositories diff different surfaces, `preview-diff.py` is generic
(it keys on the filename and nothing else), and a cross-repo `uses:` would re-couple
this repo's CI to that repo's default branch. If you fix a real bug in the differ,
consider whether the other copy has it too — that is the accepted cost.

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

## Releasing

Merging the `chore(main): release X.Y.Z` pull request is the entire release.
release-please keeps that PR up to date from conventional-commit history; merging
it cuts the tag, creates the GitHub Release, then `release.yml` builds the VSIX,
attaches it, and publishes to both marketplaces.

**Releases are deliberately infrequent.** The release PR accumulates and sits open
until someone decides to ship — merging to `main` does not release. Nothing forces
a release, and there is no schedule.

### The version is the extension's own

This is the thing most likely to trip you up if you know the monorepo. There,
`vX.Y.Z` was the *plugin* version and the extension was stamped with it, so the
two numbers were the same by construction. Here they are unrelated:

| Number | Lives in | Means |
| --- | --- | --- |
| Extension version | `package.json`, managed by release-please | What users install |
| Plugin coordinate | `plugin-version.json`, hand-bumped | What the extension injects into a Gradle build |

`1.46.2` is seeded in `.release-please-manifest.json` only so the first
independent release is strictly greater than the last one the monorepo published
(the marketplaces require a strictly increasing version). **They diverge from
there and are not expected to line up again.** An extension release does not
imply a plugin release, or the reverse.

The concrete trap: **`release.yml` must never set `PLUGIN_VERSION` from the tag.**
The upstream job did, correctly, because the tag *was* the plugin version. Doing
it here would bake a plugin coordinate that does not exist into
`BUNDLED_PLUGIN_VERSION`, and the failure would surface as an unexplained Gradle
resolution error in a user's build. The workflow instead lets
`scripts/generate-version.mjs` read the pin, and then asserts that the compiled
`src/version.generated.ts` carries it.

### Secrets

Two repository secrets, both required to publish:

| Secret | What it is |
| --- | --- |
| `VSCE_PAT` | Azure DevOps PAT for publisher `yuri-schimke`, scope **Marketplace → Manage** |
| `OVSX_PAT` | Access token from open-vsx.org for the `yuri-schimke` namespace |

They cannot be copied from another repository — GitHub never exposes a secret's
value through the API, and this account has no org-level shared secrets. Set them
under **Settings → Secrets and variables → Actions**. If either is missing the
publish job fails immediately with a step that names it, rather than skipping
quietly.

### What the release checks before it ships

- **The pinned plugin still resolves on Maven Central.** `Plugin Pin` checks this
  when `plugin-version.json` changes; the release re-checks it, which catches a
  pin that was fine at merge and got yanked before shipping.
- **The tag matches `package.json`.** A mismatch means the tag was cut by hand;
  stamping over it would publish a VSIX whose version is not the one in the
  repository.
- **The built `src/version.generated.ts` carries the pinned plugin version**, so a
  broken generator fails the release rather than a user's build.
- **The GitHub Release stays a draft until its VSIX is attached**, so
  `/releases/latest` never points at a version whose asset has not uploaded.

Marketplace publishing runs in parallel with attaching the asset — the two
distribution channels are independent, and neither blocks the other. Both publish
steps treat "already published" as success, so re-running `release.yml` via
`workflow_dispatch` over a partly-published tag completes the half that failed.
That is the recovery path for a missing secret or a marketplace outage.

## Conventional commits

Commit subjects and PR titles use conventional-commit prefixes (`fix:`, `feat:`,
`docs:`, `test:`, `ci:`, …), matching the upstream repo's convention.
