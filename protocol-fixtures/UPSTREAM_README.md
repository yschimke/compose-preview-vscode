# Protocol fixtures

Golden JSON message samples for the preview-daemon IPC protocol — see [../PROTOCOL.md](../PROTOCOL.md).

Each message kind lives in its own file: `<direction>-<method>.json` (e.g. `client-initialize.json`, `daemon-renderFinished.json`). Both the Kotlin daemon test suite and the TypeScript client test suite load these fixtures and assert round-trip serialisation matches.

Add a fixture in the same PR that adds or changes a protocol message.

Fixture inventory (added in B1.2):

- `client-initialize.json` — `initialize` request params (§ 3).
- `daemon-initializeResult.json` — `initialize` response result (§ 3).
- `client-setVisible.json`, `client-setFocus.json`, `client-fileChanged.json` — client → daemon notifications (§ 4).
- `client-renderNow.json`, `client-renderNow-overrides.json`, `daemon-renderNowResult.json` — `renderNow` request (with and without `overrides`) and response (§ 5).
- `daemon-discoveryUpdated.json`, `daemon-renderStarted.json`, `daemon-renderFinished.json`, `daemon-renderFailed.json`, `daemon-classpathDirty.json`, `daemon-sandboxRecycle.json`, `daemon-daemonWarming.json`, `daemon-daemonReady.json`, `daemon-log.json` — daemon → client notifications (§ 6).
- `client-previewRows.json`, `daemon-previewRowsResult.json` — `preview/rows` request and response (§ 5), the `@PreviewParameter` row enumeration surface (issue #3749). The result fixture carries both row spellings on purpose: a derived label (`Crimson`) and the positional `PARAM_<idx>` fallback.
- `client-initialize-bootProgress.json`, `daemon-initializeResult-booting.json` — `initialize` from a client that opted in to an early answer (`capabilities.bootProgress`), and the early answer (`booting: true`) from a daemon whose host is still booting (§ 3, compose-ai-tools#6114).
- `daemon-bootProgress.json`, `daemon-bootProgress-ready.json`, `daemon-bootProgress-failed.json` — `bootProgress` notifications after an early `initialize`: a per-slot phase, and the two terminal phases (§ 6).
- `envelope-request.json`, `envelope-response.json`, `envelope-notification.json`, `envelope-errorResponse.json` — JSON-RPC envelope shapes (§ 2).

D1 (data products — see [../DATA-PRODUCTS.md](../DATA-PRODUCTS.md)):

- `client-dataFetch.json`, `daemon-dataFetchResult.json` — `data/fetch` request and response (§ "Wire surface").
- `client-dataSubscribe.json`, `daemon-dataSubscribeResult.json` — `data/subscribe` (and the symmetric `data/unsubscribe`, same shape) request and response.
- `daemon-renderFinished-withDataProducts.json` — `renderFinished` carrying a populated `dataProducts` field; the existing `daemon-renderFinished.json` continues to cover the "no attachments" case.
- `client-dataSubscribe-withParams.json` — `data/subscribe` carrying a per-kind `params` bag (e.g. `compose/recomposition`'s `{frameStreamId, mode}`).
- `daemon-renderFinished-withRecomposition.json` — `renderFinished` carrying a `compose/recomposition` delta payload (D5). Pairs with the click-driven flush path in `RecompositionDataProductRegistry`.
- `daemon-renderFinished-withWorkTrace.json` — `renderFinished` carrying a `workTrace`: the post-capture processors and data kinds the render ran, with per-step milliseconds (compose-preview-server#1181). Absent from older daemons and never encoded when absent.

Stream C (TypeScript) loads the same files in C1.1.
