// The UI Builder custom editor's webview document, built from the web
// archive's own `index.html`.
//
// Pure, so the harness and unit tests drive exactly what the extension serves.
// Three things turn the archive's page into a webview page:
//
// - `<base href>` at the unpacked archive, as a webview resource URI. Every URL
//   in the archive is relative, and a webview rewrites nothing for you.
// - A CSP. The archive needs more than the extension's other panels: Kotlin/Wasm
//   compiles modules (`'wasm-unsafe-eval'`), `uiBuilder.mjs` statically imports
//   sibling modules (so `script-src` names the resource origin, not only the
//   nonce), and the Wasm and font fetches need `connect-src`. Every `<script>`
//   gets the nonce — including the inline `<script type="importmap">`, which a
//   nonce-only policy blocks like any other inline script, and whose failure
//   reads as a bare-specifier module error rather than a CSP report
//   (spikes/ui-builder-wasm/README.md).
// - The bootstrap, which defines `globalThis.composeUiBuilderHost` before the
//   module loads. Defining it is what puts the editor in its host-bridge mode
//   (compose-ui-builder `HostBridgeApp.kt`): the design is this extension's
//   TextDocument, and the two exchange it over postMessage.

export interface UiBuilderHtmlInput {
    /** The archive's `index.html`, verbatim. */
    indexHtml: string;
    /** The unpacked archive's root as a webview URI, ending in `/`. */
    baseHref: string;
    /** `webview.cspSource`. */
    cspSource: string;
    nonce: string;
    /**
     * Which half of the split this page is: the `.uid` custom editor, or the
     * Design Preview view that follows it. Both run the same archive.
     */
    role: UiBuilderRole;
}

export type UiBuilderRole = "editor" | "preview";

/** Messages the extension sends the bootstrap (not the editor). */
export const UI_BUILDER_STATUS_MESSAGE = "compose-preview/ui-builder-status";
/** Messages the bootstrap sends the extension about the page itself. */
export const UI_BUILDER_PAGE_ERROR_MESSAGE =
    "compose-preview/ui-builder-page-error";

export function uiBuilderCsp(cspSource: string, nonce: string): string {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${cspSource}`,
        // Compose and the archive's own page set inline styles.
        `style-src ${cspSource} 'unsafe-inline'`,
        `img-src ${cspSource} data: blob:`,
        `font-src ${cspSource} data: blob:`,
        `connect-src ${cspSource} data: blob:`,
        `worker-src ${cspSource} blob:`,
    ].join("; ");
}

export function uiBuilderWebviewHtml(input: UiBuilderHtmlInput): string {
    const { indexHtml, baseHref, cspSource, nonce, role } = input;
    if (!/<head[^>]*>/i.test(indexHtml)) {
        throw new Error("the UI Builder archive's index.html has no <head>");
    }
    if (!baseHref.endsWith("/")) {
        throw new Error(`baseHref must end in '/': ${baseHref}`);
    }
    const head = [
        `<base href="${escapeAttribute(baseHref)}">`,
        `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(uiBuilderCsp(cspSource, nonce))}">`,
        `<style>${BOOTSTRAP_STYLE}</style>`,
        `<script>${bootstrapScript(role)}</script>`,
    ].join("\n    ");
    const withHead = indexHtml.replace(
        /<head([^>]*)>/i,
        (match) => `${match}\n    ${head}`,
    );
    // After the insertion, so the bootstrap is nonced by the same pass as the
    // archive's own tags. A tag that already carries a nonce is left alone.
    return withHead.replace(
        /<script(?![^>]*\bnonce=)/gi,
        `<script nonce="${nonce}"`,
    );
}

function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}

const BOOTSTRAP_STYLE = `
#compose-preview-ui-builder-status {
    position: fixed; left: 0; right: 0; top: 0; z-index: 2147483647;
    padding: 6px 12px; font: 12px/1.4 var(--vscode-font-family, system-ui, sans-serif);
    color: var(--vscode-editorWarning-foreground, #1c1b1f);
    background: var(--vscode-inputValidation-warningBackground, #fff4ce);
    border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, #b89500);
    display: none;
}
#compose-preview-ui-builder-status[data-severity="error"] {
    color: var(--vscode-errorForeground, #410e0b);
    background: var(--vscode-inputValidation-errorBackground, #f9dedc);
    border-bottom-color: var(--vscode-inputValidation-errorBorder, #b3261e);
}`;

/** Runs before the editor module. */
function bootstrapScript(role: UiBuilderRole): string {
    return `
(() => {
    const vscode = acquireVsCodeApi();
    globalThis.composeUiBuilderHost = {
        role: ${JSON.stringify(role)},
        postMessage: (message) => vscode.postMessage(message),
    };
    const statusId = "compose-preview-ui-builder-status";
    function showStatus(message, severity) {
        let banner = document.getElementById(statusId);
        if (!banner) {
            banner = document.createElement("div");
            banner.id = statusId;
            banner.setAttribute("role", "status");
            document.body.appendChild(banner);
        }
        banner.textContent = message || "";
        banner.dataset.severity = severity || "warning";
        banner.style.display = message ? "block" : "none";
    }
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (data && data.type === ${JSON.stringify(UI_BUILDER_STATUS_MESSAGE)}) {
            showStatus(data.message, data.severity);
        }
    });
    const report = (message) =>
        vscode.postMessage({ type: ${JSON.stringify(UI_BUILDER_PAGE_ERROR_MESSAGE)}, message: String(message) });
    window.addEventListener("error", (event) => report(event.message));
    window.addEventListener("unhandledrejection", (event) =>
        report(event.reason && event.reason.message ? event.reason.message : event.reason));
})();`;
}
