// Registers the early-access Compose UI Builder: the `.uid` custom editor and
// the two side-bar views that follow it. See uiBuilderEditorProvider.ts.

import * as vscode from "vscode";
import {
    UI_BUILDER_VIEW_TYPE,
    UiBuilderEditorProvider,
    UiBuilderHost,
} from "./uiBuilderEditorProvider";
import { UI_BUILDER_CHROME_COMMANDS } from "./uiBuilderChrome";
import {
    UI_BUILDER_LAYERS_VIEW,
    UI_BUILDER_PREVIEW_VIEW,
    UI_BUILDER_SELECT_LAYER_COMMAND,
    UiBuilderLayersProvider,
    UiBuilderPreviewViewProvider,
} from "./uiBuilderViews";

export function registerUiBuilder(
    context: vscode.ExtensionContext,
    log: (message: string) => void,
): UiBuilderEditorProvider {
    const host = new UiBuilderHost(context.globalStorageUri, log);
    const editors = new UiBuilderEditorProvider(host);
    const layers = new UiBuilderLayersProvider(editors);
    const layersTree = vscode.window.createTreeView(UI_BUILDER_LAYERS_VIEW, {
        treeDataProvider: layers,
        showCollapseAll: true,
    });
    layers.attach(layersTree);
    const preview = new UiBuilderPreviewViewProvider(editors);

    context.subscriptions.push(
        layers,
        layersTree,
        preview,
        vscode.window.registerCustomEditorProvider(
            UI_BUILDER_VIEW_TYPE,
            editors,
            {
                // The editor is a ~70 MB Wasm module: rebuilding it on every tab
                // switch would cost seconds each time.
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            },
        ),
        vscode.window.registerWebviewViewProvider(
            UI_BUILDER_PREVIEW_VIEW,
            preview,
            {
                webviewOptions: { retainContextWhenHidden: true },
            },
        ),
        vscode.commands.registerCommand(
            UI_BUILDER_SELECT_LAYER_COMMAND,
            (nodeId: string) => editors.selectInActive(nodeId),
        ),
        vscode.commands.registerCommand(
            "composePreview.uiBuilder.newDesign",
            () => editors.newDesign(),
        ),
        vscode.commands.registerCommand(
            "composePreview.uiBuilder.openAsText",
            async () => {
                const uri = editors.active?.document.uri;
                if (uri) {
                    await vscode.commands.executeCommand(
                        "vscode.openWith",
                        uri,
                        "default",
                        vscode.ViewColumn.Beside,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "composePreview.uiBuilder.openInEditor",
            async (uri?: vscode.Uri) => {
                const target =
                    uri ?? vscode.window.activeTextEditor?.document.uri;
                if (target) {
                    await vscode.commands.executeCommand(
                        "vscode.openWith",
                        target,
                        UI_BUILDER_VIEW_TYPE,
                    );
                }
            },
        ),
        vscode.commands.registerCommand("composePreview.uiBuilder.reload", () =>
            editors.reloadAll(),
        ),
        // The editor's own toolbar and rails, as editor-title actions.
        ...UI_BUILDER_CHROME_COMMANDS.map((entry) =>
            vscode.commands.registerCommand(entry.command, () =>
                editors.invokeInActive(entry.actionId),
            ),
        ),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration(
                    "composePreview.uiBuilder.webDistPath",
                ) ||
                event.affectsConfiguration(
                    "composePreview.earlyFeatures.enabled",
                )
            ) {
                editors.reloadAll();
            }
        }),
    );
    return editors;
}
