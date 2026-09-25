// The UI Builder editor's toolbar and rails, drawn as VS Code chrome.
//
// The editor runs with compose-ui-builder's `UiBuilderHostChrome`: it draws no
// toolbar and no rails, and publishes what they held as actions with stable
// ids (`chrome` messages). This file is the VS Code half: which of those ids
// become editor-title buttons, which go in the editor's "…" menu, and the
// context keys that show, enable and flip them. The commands themselves are
// declared in package.json, where a unit test holds them to this table.
//
// Pure — no `vscode` import — so the table and the context-key derivation are
// tested directly.

/** One control as the editor publishes it (compose-ui-builder `UiBuilderHostAction`). */
export interface UiBuilderHostAction {
    id: string;
    label: string;
    group: "toolbar" | "navigator" | "dock" | "overflow" | string;
    icon: string;
    enabled: boolean;
    checked: boolean | null;
    badge: number;
    shortcut: string;
}

export interface UiBuilderChromeCommand {
    /** The `composePreview.uiBuilder.*` command. */
    command: string;
    title: string;
    icon?: string;
    /** Where it sits: an editor-title button, or the editor's "…" menu. */
    placement: "title" | "menu";
    /** The editor action it invokes. */
    actionId: string;
    /**
     * For a button that flips a panel: shown only while the panel is in this
     * state, so the pair reads like VS Code's own side-bar toggles.
     */
    showWhenChecked?: boolean;
}

export const UI_BUILDER_CHROME_COMMANDS: readonly UiBuilderChromeCommand[] = [
    {
        command: "composePreview.uiBuilder.undo",
        title: "Undo",
        icon: "$(discard)",
        placement: "title",
        actionId: "undo",
    },
    {
        command: "composePreview.uiBuilder.redo",
        title: "Redo",
        icon: "$(redo)",
        placement: "title",
        actionId: "redo",
    },
    {
        command: "composePreview.uiBuilder.showComponents",
        title: "Show Components",
        icon: "$(layout-sidebar-left-off)",
        placement: "title",
        actionId: "navigator.insert",
        showWhenChecked: false,
    },
    {
        command: "composePreview.uiBuilder.hideComponents",
        title: "Hide Components",
        icon: "$(layout-sidebar-left)",
        placement: "title",
        actionId: "navigator.insert",
        showWhenChecked: true,
    },
    {
        command: "composePreview.uiBuilder.showProperties",
        title: "Show Properties",
        icon: "$(layout-sidebar-right-off)",
        placement: "title",
        actionId: "dock.properties",
        showWhenChecked: false,
    },
    {
        command: "composePreview.uiBuilder.hideProperties",
        title: "Hide Properties",
        icon: "$(layout-sidebar-right)",
        placement: "title",
        actionId: "dock.properties",
        showWhenChecked: true,
    },
    {
        command: "composePreview.uiBuilder.toggleCode",
        title: "Toggle Generated Code",
        icon: "$(code)",
        placement: "title",
        actionId: "dock.code",
    },
    {
        command: "composePreview.uiBuilder.toggleTheme",
        title: "Theme",
        placement: "menu",
        actionId: "dock.theme",
    },
    {
        command: "composePreview.uiBuilder.toggleScreen",
        title: "Screen",
        placement: "menu",
        actionId: "dock.screen",
    },
    {
        command: "composePreview.uiBuilder.toggleIssues",
        title: "Issues",
        placement: "menu",
        actionId: "dock.issues",
    },
    {
        command: "composePreview.uiBuilder.toggleComments",
        title: "Comments",
        placement: "menu",
        actionId: "dock.comments",
    },
    {
        command: "composePreview.uiBuilder.toggleHistory",
        title: "History",
        placement: "menu",
        actionId: "dock.history",
    },
    {
        command: "composePreview.uiBuilder.toggleEditorLayers",
        title: "Layers (in the Editor)",
        placement: "menu",
        actionId: "navigator.layers",
    },
    {
        command: "composePreview.uiBuilder.toggleReference",
        title: "Toggle Reference Image",
        placement: "menu",
        actionId: "reference",
    },
    {
        command: "composePreview.uiBuilder.tidy",
        title: "Tidy to the 4dp Grid",
        placement: "menu",
        actionId: "overflow.tidy",
    },
    {
        command: "composePreview.uiBuilder.componentPacks",
        title: "Component Packs…",
        placement: "menu",
        actionId: "overflow.packs",
    },
    {
        command: "composePreview.uiBuilder.shortcuts",
        title: "Keyboard Shortcuts",
        placement: "menu",
        actionId: "overflow.shortcuts",
    },
    {
        command: "composePreview.uiBuilder.help",
        title: "UI Builder Help",
        placement: "menu",
        actionId: "overflow.help",
    },
];

const CONTEXT_PREFIX = "composePreview.uiBuilder.action";

/** `composePreview.uiBuilder.action.<id>.<facet>`, one boolean each. */
export function actionContextKey(
    actionId: string,
    facet: "present" | "enabled" | "checked",
): string {
    return `${CONTEXT_PREFIX}.${actionId}.${facet}`;
}

/** Every context key the table can set, for clearing them when no design is focused. */
export function allActionContextKeys(): string[] {
    const ids = [...new Set(UI_BUILDER_CHROME_COMMANDS.map((c) => c.actionId))];
    return ids.flatMap((id) =>
        (["present", "enabled", "checked"] as const).map((facet) =>
            actionContextKey(id, facet),
        ),
    );
}

/**
 * The context keys for [actions]: every key the table knows, true or false.
 * An action the editor stopped publishing (the reference toggle once the
 * reference is gone) turns its key off rather than leaving it stale.
 */
export function actionContextValues(
    actions: readonly UiBuilderHostAction[] | undefined,
): Map<string, boolean> {
    const byId = new Map((actions ?? []).map((a) => [a.id, a]));
    const values = new Map<string, boolean>();
    for (const key of allActionContextKeys()) values.set(key, false);
    for (const action of byId.values()) {
        if (!UI_BUILDER_CHROME_COMMANDS.some((c) => c.actionId === action.id)) {
            continue;
        }
        values.set(actionContextKey(action.id, "present"), true);
        values.set(actionContextKey(action.id, "enabled"), action.enabled);
        values.set(
            actionContextKey(action.id, "checked"),
            action.checked === true,
        );
    }
    return values;
}

const EDITOR_ACTIVE = "activeCustomEditorId == composePreview.uiBuilder";

/** The `when` clause a command's editor-title menu entry carries. */
export function menuWhen(command: UiBuilderChromeCommand): string {
    const parts = [
        EDITOR_ACTIVE,
        actionContextKey(command.actionId, "present"),
    ];
    if (command.showWhenChecked === true) {
        parts.push(actionContextKey(command.actionId, "checked"));
    } else if (command.showWhenChecked === false) {
        parts.push(`!${actionContextKey(command.actionId, "checked")}`);
    }
    return parts.join(" && ");
}

/** The `enablement` a command carries: only while the editor says it can run. */
export function commandEnablement(command: UiBuilderChromeCommand): string {
    return actionContextKey(command.actionId, "enabled");
}

/** The editor-title menu group: buttons in order, then the "…" menu. */
export function menuGroup(command: UiBuilderChromeCommand): string {
    const index = UI_BUILDER_CHROME_COMMANDS.indexOf(command);
    return command.placement === "title"
        ? `navigation@${index + 10}`
        : `ui-builder@${index}`;
}
