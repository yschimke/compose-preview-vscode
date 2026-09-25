// The UI Builder, split the way the IntelliJ plugin splits it:
//
// - **Editor** — `.uid` files open in a custom text editor running the
//   compose-ui-builder Wasm editor (canvas + inspector). This file.
// - **Views** — beside it in the Compose Preview side bar, following whichever
//   design is active: a native Layers tree (uiBuilderLayersView.ts) and the
//   Design Preview, the same editor archive with only its Preview pane
//   (uiBuilderPreviewView.ts). IntelliJ's equivalents are the structure view
//   and the "Preview" tool window.
//
// The TextDocument is the design (see uiBuilderSync.ts), and the Wasm editor
// talks to this file over its host bridge (compose-ui-builder
// `HostBridgeApp.kt`). Early access: behind `composePreview.earlyFeatures.enabled`.

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
    DESIGN_TEMPLATES,
    designIdFor,
    parseDesign,
    type DesignDocument,
    type DesignTemplate,
} from "./uiBuilderDesign";
import {
    downloadBytes,
    resolveUiBuilderDist,
    type UiBuilderDist,
} from "./uiBuilderDist";
import {
    UI_BUILDER_PAGE_ERROR_MESSAGE,
    UI_BUILDER_STATUS_MESSAGE,
    uiBuilderWebviewHtml,
    type UiBuilderRole,
} from "./uiBuilderHtml";
import { UiBuilderDocumentSync } from "./uiBuilderSync";
import {
    actionContextValues,
    type UiBuilderHostAction,
} from "./uiBuilderChrome";

export const UI_BUILDER_VIEW_TYPE = "composePreview.uiBuilder";
const HAS_ACTIVE_DESIGN_CONTEXT = "composePreview.uiBuilder.hasActiveDesign";

/** Messages the Wasm editor posts over its host bridge. */
type FromEditor =
    | { type: "compose-ui-builder/ready" }
    | { type: "compose-ui-builder/changed"; document: string }
    | { type: "compose-ui-builder/selection"; nodeId: string }
    | { type: "compose-ui-builder/chrome"; actions: UiBuilderHostAction[] }
    | { type: "compose-ui-builder/error"; message: string }
    | { type: "compose-ui-builder/open-link"; url: string }
    | { type: typeof UI_BUILDER_PAGE_ERROR_MESSAGE; message: string }
    | { type: "compose-preview/ui-builder-enable-early-features" }
    | { type: "compose-preview/ui-builder-open-as-text" };

/**
 * What every UI Builder webview shares: the archive, the catalogs in it, and
 * the page built from it. One per extension activation.
 */
export class UiBuilderHost {
    private dist: Promise<UiBuilderDist> | undefined;
    private readonly capabilities = new Map<string, Promise<string>>();

    constructor(
        private readonly globalStorageUri: vscode.Uri,
        readonly log: (message: string) => void,
    ) {}

    earlyFeaturesEnabled(): boolean {
        return vscode.workspace
            .getConfiguration("composePreview")
            .get<boolean>("earlyFeatures.enabled", false);
    }

    /** Forgets the archive, after `webDistPath` changes or a failed resolve. */
    reset(): void {
        this.dist = undefined;
        this.capabilities.clear();
    }

    resolveDist(): Promise<UiBuilderDist> {
        if (!this.dist) {
            const configuredPath = vscode.workspace
                .getConfiguration("composePreview")
                .get<string>("uiBuilder.webDistPath", "");
            const pending: Promise<UiBuilderDist> = Promise.resolve(
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Window,
                        title: "Compose UI Builder: preparing the editor",
                    },
                    () =>
                        resolveUiBuilderDist({
                            configuredPath,
                            storageRoot: path.join(
                                this.globalStorageUri.fsPath,
                                "ui-builder-web",
                            ),
                            download: downloadBytes,
                            log: this.log,
                        }),
                ),
            ).then(
                (dist) => {
                    this.log(
                        `[ui-builder] editor ${dist.manifest.version} from ${dist.source}`,
                    );
                    return dist;
                },
                (error: unknown) => {
                    this.dist = undefined;
                    throw error;
                },
            );
            this.dist = pending;
            return pending;
        }
        return this.dist;
    }

    /** The capability JSON of [systemId], read from the archive's root. */
    capabilitiesFor(systemId: string): Promise<string> {
        let pending = this.capabilities.get(systemId);
        if (!pending) {
            pending = this.resolveDist().then(async (dist) => {
                if (!/^[a-z0-9-]+$/.test(systemId)) {
                    throw new Error(
                        `catalog id ${systemId} is not one the editor packages`,
                    );
                }
                const file = path.join(
                    dist.root,
                    `${systemId}-capabilities-v1.json`,
                );
                try {
                    return await fs.readFile(file, "utf8");
                } catch {
                    throw new Error(
                        `the UI Builder editor ${dist.manifest.version} does not package the '${systemId}' catalog`,
                    );
                }
            });
            pending.catch(() => this.capabilities.delete(systemId));
            this.capabilities.set(systemId, pending);
        }
        return pending;
    }

    async fixture(): Promise<string> {
        const dist = await this.resolveDist();
        return fs.readFile(
            path.join(dist.root, "jetcaster-discover-operations-v1.json"),
            "utf8",
        );
    }

    /** Points [webview] at the archive and loads the editor in [role]. */
    async loadEditor(
        webview: vscode.Webview,
        role: UiBuilderRole,
    ): Promise<void> {
        const dist = await this.resolveDist();
        const root = vscode.Uri.file(dist.root);
        webview.options = {
            enableScripts: true,
            localResourceRoots: [root],
        };
        webview.html = uiBuilderWebviewHtml({
            indexHtml: await fs.readFile(
                path.join(dist.root, "index.html"),
                "utf8",
            ),
            baseHref: `${webview.asWebviewUri(root).toString()}/`,
            cspSource: webview.cspSource,
            nonce: crypto.randomBytes(16).toString("base64"),
            role,
        });
    }

    /** Sends [design] to a webview running the editor archive. */
    async postOpen(
        webview: vscode.Webview,
        design: DesignDocument,
        text: string,
    ): Promise<void> {
        const capabilities = await this.capabilitiesFor(
            design.catalogPin.systemId,
        );
        await webview.postMessage({
            type: "compose-ui-builder/open",
            document: text,
            capabilities,
        });
    }

    postStatus(
        webview: vscode.Webview,
        message: string | undefined,
        severity: "warning" | "error" = "warning",
    ): void {
        void webview.postMessage({
            type: UI_BUILDER_STATUS_MESSAGE,
            message,
            severity,
        });
    }
}

/** One open `.uid` custom editor. */
export class UiBuilderSession implements vscode.Disposable {
    private readonly designChanged = new vscode.EventEmitter<void>();
    /** Fires when the document's design changes, from any source. */
    readonly onDidChangeDesign = this.designChanged.event;
    private readonly selectionChanged = new vscode.EventEmitter<
        string | undefined
    >();
    readonly onDidChangeSelection = this.selectionChanged.event;

    /** The last readable design in the document. */
    design: DesignDocument | undefined;
    /** The toolbar and rail controls the editor asked VS Code to draw. */
    chrome: UiBuilderHostAction[] = [];
    selectedNodeId: string | undefined;
    readonly sync: UiBuilderDocumentSync;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        readonly document: vscode.TextDocument,
        readonly panel: vscode.WebviewPanel,
        private readonly host: UiBuilderHost,
    ) {
        this.sync = new UiBuilderDocumentSync({
            readText: () => document.getText(),
            applyText: (text) => {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    text,
                );
                return vscode.workspace.applyEdit(edit);
            },
            openInEditor: (design, text) => {
                host.postOpen(panel.webview, design, text).catch(
                    (error: unknown) =>
                        host.postStatus(
                            panel.webview,
                            String((error as Error).message ?? error),
                            "error",
                        ),
                );
            },
            showStatus: (message, severity) =>
                host.postStatus(panel.webview, message, severity),
            setTimer: (callback, ms) => setTimeout(callback, ms),
            clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
        });
        this.refreshDesign();
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (
                    event.document !== document ||
                    event.contentChanges.length === 0
                ) {
                    return;
                }
                this.refreshDesign();
                this.sync.documentChanged();
            }),
        );
    }

    private refreshDesign(): void {
        const parsed = parseDesign(this.document.getText());
        if (parsed.kind === "design") {
            this.design = parsed.design;
            this.designChanged.fire();
        }
    }

    setSelection(nodeId: string | undefined): void {
        if (nodeId === this.selectedNodeId) return;
        this.selectedNodeId = nodeId;
        this.selectionChanged.fire(nodeId);
    }

    /** Runs one of the editor's own controls, drawn as VS Code chrome. */
    invoke(actionId: string): void {
        void this.panel.webview.postMessage({
            type: "compose-ui-builder/invoke",
            id: actionId,
        });
    }

    /** Selects [nodeId] in the editor, as if its layer had been clicked there. */
    select(nodeId: string): void {
        void this.panel.webview.postMessage({
            type: "compose-ui-builder/select",
            nodeId,
        });
    }

    dispose(): void {
        this.sync.dispose();
        this.designChanged.dispose();
        this.selectionChanged.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
}

export class UiBuilderEditorProvider
    implements vscode.CustomTextEditorProvider
{
    private readonly sessions = new Set<UiBuilderSession>();
    private activeSession: UiBuilderSession | undefined;
    private readonly activeChanged = new vscode.EventEmitter<
        UiBuilderSession | undefined
    >();
    /** The design the side-bar views follow: the focused UI Builder editor. */
    readonly onDidChangeActiveSession = this.activeChanged.event;
    /** Templates chosen by `New Design…` for a file it just created. */
    private readonly pendingTemplates = new Map<string, DesignTemplate>();

    constructor(readonly host: UiBuilderHost) {}

    get active(): UiBuilderSession | undefined {
        return this.activeSession;
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
    ): Promise<void> {
        const session = new UiBuilderSession(document, panel, this.host);
        this.sessions.add(session);
        panel.onDidDispose(() => {
            this.sessions.delete(session);
            session.dispose();
            if (this.activeSession === session) this.setActive(undefined);
        });
        panel.onDidChangeViewState(() => {
            if (panel.active) this.setActive(session);
            else if (this.activeSession === session && !panel.visible) {
                this.setActive(undefined);
            }
        });
        panel.webview.onDidReceiveMessage((message: FromEditor) =>
            this.onMessage(session, message),
        );
        if (panel.active) this.setActive(session);
        await this.load(session);
    }

    private async load(session: UiBuilderSession): Promise<void> {
        const webview = session.panel.webview;
        if (!this.host.earlyFeaturesEnabled()) {
            webview.options = { enableScripts: true };
            webview.html = earlyAccessHtml(webview.cspSource);
            return;
        }
        try {
            await this.host.loadEditor(webview, "editor");
        } catch (error) {
            const message = (error as Error).message ?? String(error);
            this.host.log(`[ui-builder] ${message}`);
            webview.options = { enableScripts: true };
            webview.html = failureHtml(message);
        }
    }

    private async onMessage(
        session: UiBuilderSession,
        message: FromEditor,
    ): Promise<void> {
        switch (message.type) {
            case "compose-ui-builder/ready":
                if (session.document.getText().trim().length === 0) {
                    await this.seed(session);
                } else {
                    session.sync.reload();
                }
                break;
            case "compose-ui-builder/changed":
                session.sync.editorChanged(message.document);
                break;
            case "compose-ui-builder/selection":
                session.setSelection(message.nodeId || undefined);
                break;
            case "compose-ui-builder/chrome":
                session.chrome = message.actions;
                if (this.activeSession === session) this.publishChrome(session);
                break;
            case "compose-ui-builder/error":
                this.host.log(
                    `[ui-builder] ${session.document.uri.fsPath}: ${message.message}`,
                );
                this.host.postStatus(
                    session.panel.webview,
                    message.message,
                    "error",
                );
                break;
            case "compose-ui-builder/open-link":
                if (/^https:\/\//.test(message.url)) {
                    await vscode.env.openExternal(
                        vscode.Uri.parse(message.url),
                    );
                }
                break;
            case UI_BUILDER_PAGE_ERROR_MESSAGE:
                this.host.log(`[ui-builder] page error: ${message.message}`);
                break;
            case "compose-preview/ui-builder-enable-early-features":
                await vscode.workspace
                    .getConfiguration("composePreview")
                    .update(
                        "earlyFeatures.enabled",
                        true,
                        vscode.ConfigurationTarget.Global,
                    );
                await this.load(session);
                break;
            case "compose-preview/ui-builder-open-as-text":
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    session.document.uri,
                    "default",
                );
                break;
        }
    }

    /** An empty file: start it from a template, which the editor builds. */
    private async seed(session: UiBuilderSession): Promise<void> {
        const key = session.document.uri.toString();
        const template =
            this.pendingTemplates.get(key) ?? (await pickTemplate());
        this.pendingTemplates.delete(key);
        if (!template) {
            this.host.postStatus(
                session.panel.webview,
                "This design file is empty. Run “Compose UI Builder: New Design…” or reopen it to choose a template.",
            );
            return;
        }
        try {
            await session.panel.webview.postMessage({
                type: "compose-ui-builder/open",
                document: "",
                capabilities: await this.host.capabilitiesFor(
                    template.systemId,
                ),
                seed: {
                    designId: designIdFor(
                        path.basename(session.document.uri.fsPath),
                    ),
                    templateId: template.templateId,
                    fixture: await this.host.fixture(),
                },
            });
        } catch (error) {
            this.host.postStatus(
                session.panel.webview,
                String((error as Error).message),
                "error",
            );
        }
    }

    /** `Compose UI Builder: New Design…` */
    async newDesign(): Promise<void> {
        const template = await pickTemplate();
        if (!template) return;
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({
            defaultUri: folder
                ? vscode.Uri.joinPath(
                      folder,
                      "ui-builder",
                      "designs",
                      "new-design.uid",
                  )
                : undefined,
            filters: { "UI Builder design": ["uid"] },
            saveLabel: "Create Design",
        });
        if (!target) return;
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(target, ".."),
        );
        await vscode.workspace.fs.writeFile(target, new Uint8Array());
        this.pendingTemplates.set(target.toString(), template);
        await vscode.commands.executeCommand(
            "vscode.openWith",
            target,
            UI_BUILDER_VIEW_TYPE,
        );
    }

    selectInActive(nodeId: string): void {
        this.activeSession?.select(nodeId);
    }

    invokeInActive(actionId: string): void {
        this.activeSession?.invoke(actionId);
    }

    /**
     * Shows, enables and flips the editor-title actions for [session]'s
     * editor, or clears them all when no UI Builder editor is focused.
     */
    private publishChrome(session: UiBuilderSession | undefined): void {
        for (const [key, value] of actionContextValues(session?.chrome)) {
            void vscode.commands.executeCommand("setContext", key, value);
        }
    }

    reloadAll(): void {
        this.host.reset();
        for (const session of this.sessions) void this.load(session);
    }

    private setActive(session: UiBuilderSession | undefined): void {
        if (this.activeSession === session) return;
        this.activeSession = session;
        void vscode.commands.executeCommand(
            "setContext",
            HAS_ACTIVE_DESIGN_CONTEXT,
            !!session,
        );
        this.publishChrome(session);
        this.activeChanged.fire(session);
    }
}

async function pickTemplate(): Promise<DesignTemplate | undefined> {
    const picked = await vscode.window.showQuickPick(
        DESIGN_TEMPLATES.map((template) => ({
            label: template.label,
            detail: template.detail,
            template,
        })),
        { title: "New UI Builder design", placeHolder: "Start from…" },
    );
    return picked?.template;
}

function earlyAccessHtml(cspSource: string): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    return messagePage(
        nonce,
        cspSource,
        `<h2>Compose UI Builder is in early access</h2>
<p>This file is a Compose UI Builder design. The visual editor is one of Compose Preview's early features, and they are switched off.</p>
<p><button id="enable">Enable early features</button> <button id="text" class="secondary">Open as text</button></p>`,
        `const vscode = acquireVsCodeApi();
document.getElementById("enable").onclick = () => vscode.postMessage({ type: "compose-preview/ui-builder-enable-early-features" });
document.getElementById("text").onclick = () => vscode.postMessage({ type: "compose-preview/ui-builder-open-as-text" });`,
    );
}

function failureHtml(message: string): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    return messagePage(
        nonce,
        "",
        `<h2>The UI Builder editor could not start</h2>
<p>${escapeHtml(message)}</p>
<p><button id="text">Open as text</button></p>`,
        `const vscode = acquireVsCodeApi();
document.getElementById("text").onclick = () => vscode.postMessage({ type: "compose-preview/ui-builder-open-as-text" });`,
    );
}

function messagePage(
    nonce: string,
    cspSource: string,
    body: string,
    script: string,
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';">
    <style nonce="${nonce}">
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 24px; max-width: 44em; }
        button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 6px 14px; cursor: pointer; }
        button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    </style>
</head>
<body>
${body}
<script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
