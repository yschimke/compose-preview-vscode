/**
 * Which previews a save asks the daemon to render first. Kept out of
 * `extension.ts` so it can be tested without VS Code.
 */

/**
 * Whether [previewId] is a preview of the function [functionName]. Discovery
 * ids name the function and then, for a named or multi-preview, `_<name>`
 * (`BackgroundKt.BackgroundDefault_Dark theme`), so an exact match alone misses
 * every named preview.
 */
export function isPreviewOfFunction(
    previewId: string,
    functionName: string,
): boolean {
    const name = previewFunctionNameFromId(previewId);
    return name === functionName || name.startsWith(`${functionName}_`);
}

function previewFunctionNameFromId(previewId: string): string {
    const hash = previewId.lastIndexOf("#");
    if (hash >= 0 && hash + 1 < previewId.length) {
        return previewId.substring(hash + 1);
    }
    const dot = previewId.lastIndexOf(".");
    return dot >= 0 ? previewId.substring(dot + 1) : previewId;
}

/**
 * The previews of [ids] a save focuses: those of the function being edited
 * ([editedFunction]) and the card the panel is scoped to ([scopedPreviewId]).
 */
export function focusedPreviewIds(
    ids: readonly string[],
    editedFunction: string | undefined,
    scopedPreviewId: string | undefined,
): string[] {
    return ids.filter(
        (id) =>
            id === scopedPreviewId ||
            (editedFunction !== undefined &&
                isPreviewOfFunction(id, editedFunction)),
    );
}
