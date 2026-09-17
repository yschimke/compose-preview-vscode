# Spike: does the Kotlin/Wasm UI builder paint in a VS Code webview?

This is the spike
[`compose-ui-builder`'s handover note](https://github.com/yschimke/compose-ui-builder/blob/main/docs/design/UI_BUILDER_VSCODE_HOST.md)
puts before everything else: *"Nothing else in this note matters until that is
answered, and it cannot be answered by reading."* Both shapes it proposes — bundle
the archive and run it offline (A), or spawn `compose-preview-server` and point a
webview at a loopback URL (B) — die if the editor cannot paint inside a webview at
all.

It is a **spike**, not a feature. Nothing here ships in the VSIX, nothing in `src/`
imports it, and CI does not run it. It exists so the answer is reproducible instead
of remembered.

## Running it

```sh
# 1. stage the editor's Wasm distribution from a compose-ui-builder CHECKOUT
UI_BUILDER_CHECKOUT=../../../compose-ui-builder node stage-dist.mjs
# …or, when that checkout has already built the archive:
node stage-dist.mjs --archive=<path>/compose-preview-ui-builder-web-X.Y.Z.zip

# 2. check the instruments, then ask the question
node selftest.mjs
node paint.mjs --csp=predicted     # the CSP the handover note predicted
node paint.mjs --csp=baseline      # the extension's CSP today, unwidened
node paint.mjs --csp=none          # control: no CSP at all
```

`out/` is gitignored: it holds an ~80 MB unpacked distribution, the screenshots and
a JSON report per run. `CHROMIUM_PATH` overrides the browser when the sandbox's
installed Chromium does not match the pinned Playwright's expectation.

**The archive comes from a checkout, deliberately.** It is not fetched from a Maven
release: the current plan is a combined build against a
[`compose-ui-builder`](https://github.com/yschimke/compose-ui-builder) checkout
first, and a published asset only later, if ever. `stage-dist.mjs` therefore runs
that repository's own `:ui-builder-web:webArchive` and unpacks what it produces —
the same shape as the two generators
[AGENTS.md](../../AGENTS.md#what-is-not-here-and-where-it-went) already documents,
which need a sibling checkout and run only when someone is regenerating.

## What each piece is for

| File | Why it exists |
| --- | --- |
| `stage-dist.mjs` | Builds and unpacks the editor distribution from a checkout. |
| `host.mjs` | Serves it the way a webview presents content: one document carrying a `<meta http-equiv="Content-Security-Policy">`, a per-load nonce on every script, a `<base href>` for the archive's relative URLs. The CSP is a parameter — it is the thing under test. |
| `png.mjs` | Decodes a screenshot far enough to count colours, so "it painted" is measured rather than eyeballed. No image dependency added to a repository that has none. |
| `selftest.mjs` | Checks the instruments before trusting them: a nonced script runs, the baseline CSP blocks an un-nonced one, and the colour count separates a painted canvas from a blank page. Without it, `PAINTS: no` is ambiguous between the editor and the harness. |
| `paint.mjs` | The run. Loads the editor, records every CSP violation, page error, console error and failed request, waits for the Compose canvas, captures it, and prints a verdict. |

## Findings

Recorded as they are established, so the next person inherits evidence rather
than a claim. **The paint verdict is not in this section yet** — the run that
answers it is the point of the spike, and an unrun spike must not read like a
passed one.

### The archive, measured

From `compose-preview-ui-builder-web` as published today:

| | |
| --- | --- |
| Zipped | 18.1 MB — the handover note's 18.4 MB still holds |
| Unpacked | 80 MB, 52 files |
| `uiBuilder.wasm` | 66.6 MB |
| `skiko.wasm` | 8.6 MB |

The VSIX question in the note's open list therefore has a sharper edge than
"18 MB compressed is unremarkable": shape A ships 80 MB on disk after install,
not 18.

### The CSP needs one directive the note does not list

`index.html` carries an **inline `<script type="importmap">`** mapping
`@js-joda/core` to a relative file, and loads `uiBuilder.mjs` as an ES module.
Under the extension's nonce-only `script-src`, that importmap is an inline script
like any other: without the nonce it is blocked, the bare specifier then fails to
resolve, and **the symptom is a module resolution error rather than a CSP report
naming the importmap**. Anyone widening `previewPanel.ts`-style HTML for this
editor has to nonce the importmap, not just the module tags.

`host.mjs` nonces every `<script>` for exactly this reason, and `selftest.mjs`
asserts both halves — that a nonced script runs, and that the unwidened baseline
still blocks one whose nonce does not match.

### Instruments, verified

`node selftest.mjs` passes on all four checks (nonced script runs; painted canvas
reads as 360 colours; blank page reads as 1 colour and 0.0000 non-white; baseline
CSP blocks a mismatched nonce). So a `PAINTS: no` from `paint.mjs` is about the
editor, not the harness.

### What this environment cannot answer

The **real** VS Code webview half needs a VS Code binary, and
`update.code.visualstudio.com` is denied by this sandbox's network policy
(`403` to `CONNECT`), so `@vscode/test-electron` cannot resolve one here. What runs
here is Chromium with the webview's HTML shape and CSP — the same engine family,
the same policy, the same module and Wasm mechanics — which settles WasmGC and the
directive list but **not** the `vscode-webview://` origin, `asWebviewUri` rewriting,
or `localResourceRoots`. Those stay open until someone runs it where a VS Code
binary is reachable.
