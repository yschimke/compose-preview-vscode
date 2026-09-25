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

/**
 * Which VS Code theme colour draws which part of the editor's own UI.
 *
 * The editor takes a theme in Material 3's vocabulary (compose-ui-builder
 * `HostBridgeTheme.kt`): colour-scheme roles, plus a few editor colours that
 * are not roles. This is the VS Code half: for each, the workbench colours to
 * try in order, as the `--vscode-*` variables every webview is given. The
 * first one the current theme defines wins, and a role with none defined is
 * left to the editor's base scheme.
 *
 * The shape follows the workbench: panels are side-bar coloured, the canvas
 * behind the design is the editor background, selection is list selection,
 * buttons are buttons.
 */
export const UI_BUILDER_THEME_ROLES: Readonly<
    Record<string, readonly string[]>
> = {
    background: ["editor-background"],
    onBackground: ["editor-foreground", "foreground"],
    surface: ["sideBar-background", "editor-background"],
    onSurface: ["sideBar-foreground", "foreground"],
    surfaceVariant: ["input-background", "editorWidget-background"],
    onSurfaceVariant: ["descriptionForeground", "foreground"],
    surfaceContainerLowest: ["editor-background"],
    surfaceContainerLow: ["sideBar-background", "editor-background"],
    surfaceContainer: ["editorWidget-background", "sideBar-background"],
    surfaceContainerHigh: ["dropdown-background", "editorWidget-background"],
    surfaceContainerHighest: ["input-background", "dropdown-background"],
    // Material tints raised surfaces with this; the side bar keeps them flat, as VS Code's are.
    surfaceTint: ["sideBar-background", "editor-background"],
    inverseSurface: ["editorHoverWidget-background", "editorWidget-background"],
    inverseOnSurface: ["editorHoverWidget-foreground", "foreground"],
    primary: ["button-background", "focusBorder"],
    onPrimary: ["button-foreground"],
    primaryContainer: ["list-activeSelectionBackground"],
    onPrimaryContainer: ["list-activeSelectionForeground", "foreground"],
    secondary: ["textLink-foreground"],
    secondaryContainer: [
        "button-secondaryBackground",
        "list-inactiveSelectionBackground",
    ],
    onSecondaryContainer: ["button-secondaryForeground", "foreground"],
    tertiary: ["textLink-activeForeground", "textLink-foreground"],
    error: ["errorForeground"],
    errorContainer: ["inputValidation-errorBackground"],
    onErrorContainer: ["foreground"],
    outline: [
        "widget-border",
        "input-border",
        "panel-border",
        "contrastBorder",
    ],
    outlineVariant: ["panel-border", "sideBar-border", "editorGroup-border"],
};

export const UI_BUILDER_THEME_PALETTE: Readonly<
    Record<string, readonly string[]>
> = {
    workspace: ["editor-background"],
    layerSelected: ["list-activeSelectionBackground"],
    layerDragged: ["list-dropBackground", "list-hoverBackground"],
    dropTarget: ["list-dropBackground", "list-hoverBackground"],
    sessionBadge: ["badge-background"],
    onSessionBadge: ["badge-foreground"],
};

/** Sent to the editor page itself when the workbench theme changes. */
export const UI_BUILDER_THEME_MESSAGE = "compose-ui-builder/theme";

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
html body { background: var(--vscode-editor-background, #1e1e1e) !important; }
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
    // The workbench theme, as the editor's Material roles (UI_BUILDER_THEME_ROLES).
    const themeRoles = ${JSON.stringify(UI_BUILDER_THEME_ROLES)};
    const themePalette = ${JSON.stringify(UI_BUILDER_THEME_PALETTE)};
    function argb(value) {
        // Any CSS colour, normalised by the engine to rgb()/rgba().
        const probe = document.createElement("span");
        probe.style.color = value;
        if (!probe.style.color) return undefined;
        probe.style.display = "none";
        document.documentElement.appendChild(probe);
        const parts = getComputedStyle(probe).color.match(/[0-9.]+/g);
        probe.remove();
        if (!parts || parts.length < 3) return undefined;
        const [r, g, b] = parts.slice(0, 3).map(Number);
        const a = parts.length > 3 ? Math.round(Number(parts[3]) * 255) : 255;
        return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
    }
    function resolve(table) {
        const style = getComputedStyle(document.documentElement);
        const out = {};
        for (const [name, vars] of Object.entries(table)) {
            for (const v of vars) {
                const value = style.getPropertyValue("--vscode-" + v).trim();
                const color = value ? argb(value) : undefined;
                if (color !== undefined) {
                    out[name] = color;
                    break;
                }
            }
        }
        return out;
    }
    const readTheme = () =>
        JSON.stringify({ roles: resolve(themeRoles), palette: resolve(themePalette) });
    globalThis.composeUiBuilderHost = {
        role: ${JSON.stringify(role)},
        postMessage: (message) => vscode.postMessage(message),
        readTheme,
    };
    // VS Code rewrites the variables on <html> when the theme changes.
    let lastTheme = "";
    new MutationObserver(() => {
        const theme = readTheme();
        if (theme === lastTheme) return;
        lastTheme = theme;
        window.postMessage({ type: ${JSON.stringify(UI_BUILDER_THEME_MESSAGE)}, theme }, "*");
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
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
