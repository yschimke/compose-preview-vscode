// The UI Builder's side-bar views, which follow the focused `.uid` editor.
//
// - **Layers** — a native tree, not a webview: it is a list of rows, and VS
//   Code draws those with keyboard navigation, theming and accessibility for
//   free. Built from the document (uiBuilderDesign.ts `layerTree`), so it
//   needs no second Wasm instance. Clicking a row selects that layer in the
//   editor; selecting on the canvas reveals the row.
// - **Design Preview** — the editor archive again, in its `preview` role:
//   the devices-and-configurations pane on its own, as the IntelliJ plugin's
//   Preview tool window runs it. It only follows the document, so it can
//   never disagree with the file.

import * as vscode from "vscode";
import { layerTree, type LayerItem } from "./uiBuilderDesign";
import type {
    UiBuilderEditorProvider,
    UiBuilderSession,
} from "./uiBuilderEditorProvider";

export const UI_BUILDER_LAYERS_VIEW = "composePreview.uiBuilder.layers";
export const UI_BUILDER_PREVIEW_VIEW = "composePreview.uiBuilder.preview";
export const UI_BUILDER_SELECT_LAYER_COMMAND =
    "composePreview.uiBuilder.selectLayer";

export class UiBuilderLayersProvider
    implements vscode.TreeDataProvider<LayerItem>, vscode.Disposable
{
    private readonly changed = new vscode.EventEmitter<LayerItem | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private roots: LayerItem[] = [];
    private byNodeId = new Map<string, LayerItem>();
    private parents = new Map<LayerItem, LayerItem>();
    private tree: vscode.TreeView<LayerItem> | undefined;
    private sessionListeners: vscode.Disposable[] = [];
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly editors: UiBuilderEditorProvider) {
        this.disposables.push(
            editors.onDidChangeActiveSession((session) => this.follow(session)),
        );
    }

    attach(tree: vscode.TreeView<LayerItem>): void {
        this.tree = tree;
        this.follow(this.editors.active);
    }

    private follow(session: UiBuilderSession | undefined): void {
        this.sessionListeners.forEach((d) => d.dispose());
        this.sessionListeners = [];
        if (session) {
            this.sessionListeners.push(
                session.onDidChangeDesign(() => this.rebuild(session)),
                session.onDidChangeSelection((nodeId) => this.reveal(nodeId)),
            );
        }
        this.rebuild(session);
    }

    private rebuild(session: UiBuilderSession | undefined): void {
        this.roots = session?.design ? layerTree(session.design) : [];
        this.byNodeId = new Map();
        this.parents = new Map();
        const index = (items: LayerItem[], parent?: LayerItem) => {
            for (const item of items) {
                if (parent) this.parents.set(item, parent);
                if (item.kind === "node") this.byNodeId.set(item.nodeId, item);
                index(item.children, item);
            }
        };
        index(this.roots);
        if (this.tree) {
            this.tree.description = session?.design?.title || undefined;
        }
        this.changed.fire(undefined);
        if (session?.selectedNodeId) this.reveal(session.selectedNodeId);
    }

    private reveal(nodeId: string | undefined): void {
        const item = nodeId ? this.byNodeId.get(nodeId) : undefined;
        if (!item || !this.tree?.visible) return;
        void this.tree
            .reveal(item, { select: true, focus: false, expand: true })
            .then(undefined, () => undefined);
    }

    getChildren(element?: LayerItem): LayerItem[] {
        return element ? element.children : this.roots;
    }

    getParent(element: LayerItem): LayerItem | undefined {
        return this.parents.get(element);
    }

    getTreeItem(element: LayerItem): vscode.TreeItem {
        const item = new vscode.TreeItem(
            element.label,
            element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = element.key;
        item.description = element.description;
        if (element.kind === "slot") {
            item.iconPath = new vscode.ThemeIcon("symbol-namespace");
            item.tooltip = `Slot ${element.label}`;
        } else {
            item.iconPath = new vscode.ThemeIcon("symbol-class");
            item.tooltip = element.nodeId;
            item.command = {
                command: UI_BUILDER_SELECT_LAYER_COMMAND,
                title: "Select layer",
                arguments: [element.nodeId],
            };
        }
        return item;
    }

    dispose(): void {
        this.sessionListeners.forEach((d) => d.dispose());
        this.disposables.forEach((d) => d.dispose());
        this.changed.dispose();
    }
}

export class UiBuilderPreviewViewProvider
    implements vscode.WebviewViewProvider, vscode.Disposable
{
    private view: vscode.WebviewView | undefined;
    private ready = false;
    private sessionListener: vscode.Disposable | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private sendTimer: NodeJS.Timeout | undefined;

    constructor(private readonly editors: UiBuilderEditorProvider) {
        this.disposables.push(
            editors.onDidChangeActiveSession((session) => this.follow(session)),
        );
    }

    async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
        this.view = view;
        this.ready = false;
        view.onDidDispose(() => {
            this.view = undefined;
            this.ready = false;
        });
        view.webview.onDidReceiveMessage(
            (message: { type: string; message?: string }) => {
                if (message.type === "compose-ui-builder/ready") {
                    this.ready = true;
                    this.send();
                } else if (message.type === "compose-ui-builder/error") {
                    this.editors.host.log(
                        `[ui-builder] preview: ${message.message}`,
                    );
                }
            },
        );
        const host = this.editors.host;
        if (!host.earlyFeaturesEnabled()) {
            view.webview.html = placeholderHtml(
                "The UI Builder is an early feature. Enable composePreview.earlyFeatures.enabled to use it.",
            );
            return;
        }
        try {
            await host.loadEditor(view.webview, "preview");
        } catch (error) {
            view.webview.html = placeholderHtml(
                String((error as Error).message ?? error),
            );
        }
        this.follow(this.editors.active);
    }

    private follow(session: UiBuilderSession | undefined): void {
        this.sessionListener?.dispose();
        this.sessionListener = session?.onDidChangeDesign(() =>
            this.scheduleSend(),
        );
        this.send();
    }

    /** Coalesces a burst of edits — a slider drag — into one reload. */
    private scheduleSend(): void {
        if (this.sendTimer) clearTimeout(this.sendTimer);
        this.sendTimer = setTimeout(() => {
            this.sendTimer = undefined;
            this.send();
        }, 200);
    }

    private send(): void {
        const session = this.editors.active;
        if (!this.view || !this.ready) return;
        if (!session?.design) {
            this.editors.host.postStatus(
                this.view.webview,
                "Focus a UI Builder design (.uid) to preview it here.",
            );
            return;
        }
        this.editors.host.postStatus(this.view.webview, undefined);
        this.editors.host
            .postOpen(
                this.view.webview,
                session.design,
                session.document.getText(),
            )
            .catch((error: unknown) =>
                this.editors.host.log(
                    `[ui-builder] preview: ${(error as Error).message}`,
                ),
            );
    }

    dispose(): void {
        if (this.sendTimer) clearTimeout(this.sendTimer);
        this.sessionListener?.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
}

function placeholderHtml(message: string): string {
    const text = message.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"></head>
<body style="font-family: var(--vscode-font-family); color: var(--vscode-descriptionForeground); padding: 8px 12px;">${text}</body></html>`;
}
