import * as vscode from "vscode";

/** Where the OpenRouter key lives in VS Code's SecretStorage (the OS keychain), never in settings. */
const SECRET_KEY = "composePreview.guidelines.openRouterKey";

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/**
 * The OpenRouter key for the design-guidelines check, kept in [vscode.SecretStorage]. It is
 * read only to hand to the CLI subprocess through its environment; nothing here logs or shows it.
 */
export class GuidelinesKeyStore {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    get(): Thenable<string | undefined> {
        return this.secrets.get(SECRET_KEY);
    }

    /** Asks for a key (masked) and stores it; offers the page that creates one. */
    async prompt(): Promise<string | undefined> {
        const getKey = "Get a key";
        const enter = "Enter key";
        const choice = await vscode.window.showInformationMessage(
            "The design-guidelines check runs on your OpenRouter account. Create a key at " +
                "openrouter.ai (Settings, then Keys), then enter it here. It is stored in your " +
                "OS keychain and only passed to the compose-preview CLI.",
            enter,
            getKey,
        );
        if (choice === getKey) {
            await vscode.env.openExternal(
                vscode.Uri.parse(OPENROUTER_KEYS_URL),
            );
        }
        if (choice === undefined) {
            return undefined;
        }
        const key = await vscode.window.showInputBox({
            prompt: "OpenRouter key for the design-guidelines check",
            placeHolder: "sk-or-…",
            password: true,
            ignoreFocusOut: true,
        });
        const trimmed = key?.trim();
        if (!trimmed) {
            return undefined;
        }
        await this.secrets.store(SECRET_KEY, trimmed);
        void vscode.window.showInformationMessage("OpenRouter key saved.");
        return trimmed;
    }

    async clear(): Promise<void> {
        await this.secrets.delete(SECRET_KEY);
    }
}
