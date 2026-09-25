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
| `paint.mjs` | The original run. Loads the editor, records every CSP violation, page error, console error and failed request, waits for the Compose canvas, captures it, and prints a verdict. Its full-Chromium launch never paints in software GL; see the verdict above. |
| `bridge.mjs` | The run that answered it. Serves the page and the archive from two origins, builds the page with the extension's own `uiBuilderHtml.ts`, stubs `acquireVsCodeApi`, and plays the extension's side of the host bridge. |

## Verdict: it paints, and the bridge round-trips

**Yes — the Kotlin/Wasm editor paints under a webview-shaped CSP, from a
resource origin that is not the page's, and exchanges its document with the
host over `postMessage`.** `bridge.mjs` is the run that settles it, and it is
what the extension's `.uid` custom editor is built on:

```sh
# an archive whose ui-builder-web.json declares "hostBridge": 1
unzip -q <compose-ui-builder>/ui-builder-web/build/distributions/compose-preview-ui-builder-web-*.zip -d out/bridge-dist
npm run compile:host   # bridge.mjs drives the extension's real out/uiBuilderHtml.js
CHROMIUM_PATH=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
  node bridge.mjs --design=<file.uid> --select=<nodeId> --edit-at=<x,y>
node bridge.mjs --seed=wear-m3:wear-screen    # an empty file, seeded by the editor
node bridge.mjs --design=<file.uid> --role=preview
```

What one run establishes, measured on the 4-vCPU software-GL container that
could not answer the question before:

| | |
| --- | --- |
| First frame | ~2–3 s after navigation |
| CSP | `uiBuilderCsp` in `src/uiBuilderHtml.ts`, no violations |
| Requests that escaped to the page origin | none — the editor resolves everything against `<base href>` |
| `open` → editor | a checked-in design, or an empty file seeded from `UiBuilderNewDesignSeed` |
| editor → `changed` | on every edit, and on undo |
| host `select` → editor `selection` | round-trips |
| `preview` role | the design, in the Preview pane alone |

**Why the earlier control never painted.** Not software GL as such:
`paint.mjs` launches the *full* Chromium with `--headless=new
--use-angle=swiftshader`, and under that combination the renderer sits in
native code (it will not even honour a debugger pause) with no first frame.
Playwright's headless shell with only `--enable-unsafe-swiftshader
--use-gl=angle` — the launch compose-preview-server's own UI Builder harness
uses in CI — paints in seconds on the same box. `paint.mjs` is kept as the
record of that negative; `bridge.mjs` is the instrument to use.

**Still unrun:** a real VS Code webview (`vscode-webview://` origin,
`asWebviewUri`, `localResourceRoots`). `bridge.mjs` reproduces the two-origin
shape, which is the part that breaks things, but the sandbox cannot download
VS Code. The Electron suites in CI can.

## Findings

Recorded as they are established, so the next person inherits evidence rather
than a claim.

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

### The control does not paint in a software-GL container

Run: `paint.mjs --csp=none` — **no CSP at all**, so nothing about policy is in play.

| | |
| --- | --- |
| Environment | 4 vCPU container, no GPU, ANGLE/SwiftShader software rasterisation, Chromium 1194 |
| Result | no `#composeApp canvas` after **15 minutes**, at which point the run was killed |
| Meanwhile | a Chromium renderer process sat at ~100% CPU for the whole run |
| Playwright's own selector timeout (7 min) | never serviced — consistent with a renderer main thread that never yields |

So the editor's module **is** executing; it is not erroring out, and nothing is
blocked. It just never reaches a first frame here.

**This does not answer the spike's question, and the CSP variants were therefore
not run.** A control that cannot paint makes any CSP result meaningless: "it did
not paint under the widened CSP" would be indistinguishable from "it does not
paint in this container". Running them anyway would have produced a confident
wrong answer, which is worse than no answer.

The suspicion worth testing first is the obvious one: a 66 MB WasmGC module plus
Skiko against **software** WebGL on 4 cores. Whoever picks this up should run
`paint.mjs` on a machine with hardware GL before concluding anything about
Kotlin/Wasm in a webview — and note that a VS Code webview on a real desktop has
exactly that, which is the case the handover note actually cares about.

### What this environment cannot answer

The **real** VS Code webview half needs a VS Code binary, and
`update.code.visualstudio.com` is denied by this sandbox's network policy
(`403` to `CONNECT`), so `@vscode/test-electron` cannot resolve one here. What runs
here is Chromium with the webview's HTML shape and CSP — the same engine family,
the same policy, the same module and Wasm mechanics — which settles WasmGC and the
directive list but **not** the `vscode-webview://` origin, `asWebviewUri` rewriting,
or `localResourceRoots`. Those stay open until someone runs it where a VS Code
binary is reachable.
