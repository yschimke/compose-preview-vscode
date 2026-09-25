// Keeps one `.uid` TextDocument and one UI Builder editor webview in step.
//
// The TextDocument is the design. That is the whole point of a custom *text*
// editor: dirty state, save, revert, hot exit, the SCM diff and the text
// editor opened beside the visual one all work because VS Code owns the
// bytes. The IntelliJ plugin reaches the same place by writing the file
// itself (ProjectDesignWriter); here the editor's edits become WorkspaceEdits
// and VS Code does the rest.
//
// Two directions, each of which would otherwise echo the other:
// - **editor → document.** Each `changed` replaces the document text. Edits
//   arrive faster than a WorkspaceEdit applies — a slider drag is dozens —
//   so only the latest is applied, one at a time.
// - **document → editor.** A change the editor did not make (typing in the
//   text editor, a `git checkout`, an undo from the Edit menu) is sent back
//   as a fresh `open`, after a short pause so typing does not reload the
//   canvas per keystroke. Text that is not a readable design is not sent: the
//   editor keeps the last valid version and the page says why.
//
// No `vscode` import: the provider hands in how to read, apply and send.

import { parseDesign, type DesignDocument } from "./uiBuilderDesign";

export interface UiBuilderSyncPorts {
    /** The document's current text. */
    readText(): string;
    /** Replaces the whole document text; resolves false if VS Code refused. */
    applyText(text: string): PromiseLike<boolean>;
    /** Sends the editor a design to show. */
    openInEditor(design: DesignDocument, text: string): void;
    /** A one-line status over the editor, or undefined to clear it. */
    showStatus(
        message: string | undefined,
        severity?: "warning" | "error",
    ): void;
    /** Timers, injectable for tests. */
    setTimer(callback: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}

export const EXTERNAL_CHANGE_DEBOUNCE_MS = 250;

export class UiBuilderDocumentSync {
    /** The latest text the editor sent that is not yet in the document. */
    private pendingFromEditor: string | undefined;
    private applying = false;
    /** Text the document holds because the editor put it there. */
    private readonly writtenByEditor = new Set<string>();
    private externalTimer: unknown;
    /** The document text is not a design; the editor shows an older one. */
    private documentUnreadable = false;

    constructor(private readonly ports: UiBuilderSyncPorts) {}

    /** The editor posted `changed`. */
    editorChanged(text: string): void {
        if (this.documentUnreadable) {
            // Writing now would overwrite the text someone is fixing by hand.
            this.ports.showStatus(
                "This edit was not saved: the file is not a valid design right now. Fix it in the text editor, and the canvas will follow.",
                "error",
            );
            return;
        }
        if (text === this.ports.readText()) return;
        this.pendingFromEditor = text;
        void this.drain();
    }

    private async drain(): Promise<void> {
        if (this.applying) return;
        this.applying = true;
        try {
            while (this.pendingFromEditor !== undefined) {
                const text = this.pendingFromEditor;
                this.pendingFromEditor = undefined;
                this.writtenByEditor.add(text);
                const applied = await this.ports.applyText(text);
                if (!applied) {
                    this.writtenByEditor.delete(text);
                    this.ports.showStatus(
                        "VS Code refused the edit; the file is unchanged.",
                        "error",
                    );
                }
            }
        } finally {
            this.applying = false;
        }
    }

    /** The TextDocument changed, from any source. */
    documentChanged(): void {
        const text = this.ports.readText();
        if (this.writtenByEditor.delete(text)) {
            // Our own write coming back.
            return;
        }
        if (this.externalTimer !== undefined) {
            this.ports.clearTimer(this.externalTimer);
        }
        this.externalTimer = this.ports.setTimer(() => {
            this.externalTimer = undefined;
            this.reload();
        }, EXTERNAL_CHANGE_DEBOUNCE_MS);
    }

    /** Sends the document as it stands now. Also the first open. */
    reload(): void {
        const text = this.ports.readText();
        const parsed = parseDesign(text);
        if (parsed.kind === "design") {
            this.documentUnreadable = false;
            this.ports.showStatus(undefined);
            this.ports.openInEditor(parsed.design, text);
        } else if (parsed.kind === "invalid") {
            this.documentUnreadable = true;
            this.ports.showStatus(
                `Showing the last valid version: the file is ${parsed.reason}.`,
                "warning",
            );
        } else {
            // The file was emptied under an open editor. Seeding is for a file
            // that opens empty (the provider's business); here, writing the
            // canvas's design back would undo what someone just did to the text.
            this.documentUnreadable = true;
            this.ports.showStatus(
                "Showing the last valid version: the file is empty.",
                "warning",
            );
        }
    }

    dispose(): void {
        if (this.externalTimer !== undefined) {
            this.ports.clearTimer(this.externalTimer);
        }
    }
}
