import * as vscode from "vscode";
import { PreviewRegistry } from "./previewRegistry";

export interface DetectedPreview {
    functionName: string;
    funLineNumber: number;
    nameRange: vscode.Range;
    /**
     * The classes and objects the function is declared in, outermost first; `[]` at top level.
     * Undefined when the language server answered with flat symbols, which carry no nesting.
     */
    containers?: string[];
}

/** Flat interface over DocumentSymbol and SymbolInformation. */
interface FnLike {
    name: string;
    kind: vscode.SymbolKind;
    funLine: number;
    selectionRange: vscode.Range;
    children?: FnLike[];
    /** From `SymbolInformation`, which is flat: no nesting to read a container from. */
    flat?: boolean;
}

/**
 * Walks the document-symbol tree from whichever Kotlin LSP is active and
 * yields functions that match a preview entry in the registry.
 *
 * The registry is populated from the Gradle plugin's `previews.json`, which
 * already transitively walks meta-annotations — so this handles custom
 * multi-preview annotations (e.g. `@Devices` without `Preview` in the name)
 * and any future annotation forms the plugin supports.
 *
 * Returns `[]` when no Kotlin language server is present or no manifest has
 * been loaded yet — CodeLens and hover degrade to nothing.
 */
export async function detectPreviews(
    doc: vscode.TextDocument,
    registry: PreviewRegistry,
    log?: (msg: string) => void,
): Promise<DetectedPreview[]> {
    return (await detectFunctions(doc, log)).filter((f) =>
        registry.find(doc.uri.fsPath, f.functionName),
    );
}

/**
 * Every function and method the active Kotlin language server reports for [doc], previews or
 * not; `[]` when there is no Kotlin language server. For callers that place results by a
 * manifest they read themselves rather than by the panel's [PreviewRegistry].
 */
export async function detectFunctions(
    doc: vscode.TextDocument,
    log?: (msg: string) => void,
): Promise<DetectedPreview[]> {
    const symbols = await fetchSymbols(doc, log);
    if (!symbols) {
        return [];
    }

    const out: DetectedPreview[] = [];
    const visit = (s: FnLike, containers: string[] | undefined) => {
        const isFn =
            s.kind === vscode.SymbolKind.Function ||
            s.kind === vscode.SymbolKind.Method;
        if (isFn) {
            out.push({
                functionName: s.name.replace(/\(.*$/, "").trim(),
                funLineNumber: s.funLine,
                nameRange: s.selectionRange,
                containers,
            });
        }
        const inside =
            containers !== undefined && CONTAINER_KINDS.has(s.kind)
                ? [...containers, containerName(s.name)]
                : containers;
        s.children?.forEach((c) => visit(c, inside));
    };
    symbols.forEach((s) => visit(s, s.flat ? undefined : []));
    return out;
}

/** Symbol kinds a Kotlin function can be a member of: classes, interfaces, objects, enums. */
const CONTAINER_KINDS = new Set([
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Object,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Struct,
]);

/** A class symbol's simple name: `Outer<T>` is `Outer`, an unnamed companion `Companion`. */
function containerName(symbolName: string): string {
    const name = symbolName.replace(/<.*$/, "").trim();
    const companion = /^companion\s+object\b\s*(\w*)/.exec(name);
    if (companion) {
        return companion[1] || "Companion";
    }
    return name.replace(/^(?:object|class|interface)\s+/, "");
}

async function fetchSymbols(
    doc: vscode.TextDocument,
    log?: (msg: string) => void,
): Promise<FnLike[] | undefined> {
    try {
        const result = await vscode.commands.executeCommand<unknown>(
            "vscode.executeDocumentSymbolProvider",
            doc.uri,
        );
        if (!Array.isArray(result) || result.length === 0) {
            return undefined;
        }
        const first = result[0] as { children?: unknown; location?: unknown };
        if ("children" in first) {
            return (result as vscode.DocumentSymbol[]).map(toFnLike);
        }
        if ("location" in first) {
            return (result as vscode.SymbolInformation[]).map(siToFnLike);
        }
        log?.(
            `executeDocumentSymbolProvider returned unknown shape: ${JSON.stringify(first).slice(0, 200)}`,
        );
        return undefined;
    } catch (e) {
        log?.(`executeDocumentSymbolProvider threw: ${(e as Error).message}`);
        return undefined;
    }
}

function toFnLike(s: vscode.DocumentSymbol): FnLike {
    return {
        name: s.name,
        kind: s.kind,
        // selectionRange points at the name identifier, which is on the `fun`
        // line — `range.start` can precede it when leading annotations are
        // included in the symbol range (JetBrains.kotlin does this).
        funLine: s.selectionRange.start.line,
        selectionRange: s.selectionRange,
        children: s.children?.map(toFnLike),
    };
}

function siToFnLike(s: vscode.SymbolInformation): FnLike {
    return {
        name: s.name,
        kind: s.kind,
        funLine: s.location.range.start.line,
        selectionRange: s.location.range,
        flat: true,
    };
}
