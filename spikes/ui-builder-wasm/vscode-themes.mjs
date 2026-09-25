// The workbench colours VS Code hands a webview as `--vscode-*` variables, for
// the two default themes (Dark Modern, Light Modern), so bridge.mjs can show
// the editor themed the way it is inside VS Code without VS Code.
//
// Only the colours src/uiBuilderHtml.ts reads. Values are the themes' own.
export const VSCODE_THEMES = {
    dark: {
        "editor-background": "#1f1f1f",
        "editor-foreground": "#cccccc",
        foreground: "#cccccc",
        "sideBar-background": "#181818",
        "sideBar-foreground": "#cccccc",
        "sideBar-border": "#2b2b2b",
        "input-background": "#313131",
        "input-border": "#3c3c3c",
        "editorWidget-background": "#202020",
        descriptionForeground: "#9d9d9d",
        "dropdown-background": "#313131",
        "editorHoverWidget-background": "#202020",
        "editorHoverWidget-foreground": "#cccccc",
        "button-background": "#0078d4",
        "button-foreground": "#ffffff",
        "button-secondaryBackground": "#313131",
        "button-secondaryForeground": "#cccccc",
        focusBorder: "#0078d4",
        "list-activeSelectionBackground": "#04395e",
        "list-activeSelectionForeground": "#ffffff",
        "list-inactiveSelectionBackground": "#37373d",
        "list-hoverBackground": "#2a2d2e",
        "list-dropBackground": "#383b3d",
        "textLink-foreground": "#4daafc",
        "textLink-activeForeground": "#4daafc",
        errorForeground: "#f85149",
        "inputValidation-errorBackground": "#5a1d1d",
        "widget-border": "#313131",
        "panel-border": "#2b2b2b",
        "editorGroup-border": "#ffffff17",
        "badge-background": "#616161",
        "badge-foreground": "#f8f8f8",
    },
    light: {
        "editor-background": "#ffffff",
        "editor-foreground": "#3b3b3b",
        foreground: "#3b3b3b",
        "sideBar-background": "#f8f8f8",
        "sideBar-foreground": "#3b3b3b",
        "sideBar-border": "#e5e5e5",
        "input-background": "#ffffff",
        "input-border": "#cecece",
        "editorWidget-background": "#f8f8f8",
        descriptionForeground: "#3b3b3b",
        "dropdown-background": "#ffffff",
        "editorHoverWidget-background": "#f8f8f8",
        "editorHoverWidget-foreground": "#3b3b3b",
        "button-background": "#005fb8",
        "button-foreground": "#ffffff",
        "button-secondaryBackground": "#e5e5e5",
        "button-secondaryForeground": "#3b3b3b",
        focusBorder: "#005fb8",
        "list-activeSelectionBackground": "#e8e8e8",
        "list-activeSelectionForeground": "#000000",
        "list-inactiveSelectionBackground": "#e4e6f1",
        "list-hoverBackground": "#f2f2f2",
        "list-dropBackground": "#d6ebff",
        "textLink-foreground": "#005fb8",
        "textLink-activeForeground": "#005fb8",
        errorForeground: "#f85149",
        "inputValidation-errorBackground": "#f2dede",
        "widget-border": "#e5e5e5",
        "panel-border": "#e5e5e5",
        "editorGroup-border": "#e5e5e5",
        "badge-background": "#cccccc",
        "badge-foreground": "#3b3b3b",
    },
};

/** The `style` VS Code puts on a webview's <html> for [kind]. */
export function themeStyle(kind) {
    return Object.entries(VSCODE_THEMES[kind])
        .map(([name, value]) => `--vscode-${name}: ${value};`)
        .join(" ");
}
