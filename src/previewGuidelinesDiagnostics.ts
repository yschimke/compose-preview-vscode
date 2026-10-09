import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ModuleInfo } from "./gradleService";
import { detectPreviews } from "./previewDetection";
import { PreviewRegistry } from "./previewRegistry";
import {
    GuidelineFinding,
    GuidelineRuleInfo,
    annotatedPathFor,
    failingFindings,
    findingMessage,
    guidelinesFileCandidates,
    parseCatalogRules,
    parseModuleGuidelines,
    previewIdMatchesFunction,
} from "./guidelinesResults";
import type { PreviewManifest } from "./types";

/** The parts of [GradleService] this needs, so tests and callers can pass a stand-in. */
export interface GuidelinesModuleSource {
    readonly workspaceRoot: string;
    resolveModule(filePath: string): ModuleInfo | null;
    readManifest(module: ModuleInfo): PreviewManifest | null;
}

/**
 * Publishes the design-guidelines check's findings (`compose-preview guidelines`, which writes
 * `<module>/build/compose-previews/guidelines.json`) as diagnostics on each `@Preview` function,
 * the way [PreviewA11yDiagnostics] does for accessibility findings: same line mapping
 * ([detectPreviews]), same debounced refresh on open and edit.
 *
 * Only `fail` verdicts are problems. A rule the model answered `needs_evidence`, or left
 * unchecked, is not a finding. Each diagnostic links its rule to the guide it quotes and, when
 * `--annotate` drew one, to the render with the finding outlined.
 */
export class PreviewGuidelinesDiagnostics implements vscode.Disposable {
    private readonly collection: vscode.DiagnosticCollection;
    private readonly disposables: vscode.Disposable[] = [];
    private pending = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly registry: PreviewRegistry,
        private readonly modules: GuidelinesModuleSource,
        private readonly log?: (msg: string) => void,
    ) {
        this.collection = vscode.languages.createDiagnosticCollection(
            "compose-preview-guidelines",
        );
        this.disposables.push(this.collection);
        this.disposables.push(registry.onDidChange(() => this.refreshAll()));
        const watcher = vscode.workspace.createFileSystemWatcher(
            "**/build/compose-previews/guidelines.json",
        );
        this.disposables.push(watcher);
        this.disposables.push(watcher.onDidChange(() => this.refreshAll()));
        this.disposables.push(watcher.onDidCreate(() => this.refreshAll()));
        this.disposables.push(watcher.onDidDelete(() => this.refreshAll()));
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) =>
                this.scheduleRefresh(doc),
            ),
        );
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) =>
                this.scheduleRefresh(e.document),
            ),
        );
        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) =>
                this.collection.delete(doc.uri),
            ),
        );
        for (const doc of vscode.workspace.textDocuments) {
            this.scheduleRefresh(doc);
        }
    }

    dispose(): void {
        for (const t of this.pending.values()) {
            clearTimeout(t);
        }
        this.pending.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
    }

    /** Re-reads every open document's module results, e.g. after a check finished. */
    refreshAll(): void {
        for (const doc of vscode.workspace.textDocuments) {
            this.scheduleRefresh(doc);
        }
    }

    private scheduleRefresh(doc: vscode.TextDocument): void {
        if (doc.languageId !== "kotlin") {
            return;
        }
        const key = doc.uri.toString();
        const existing = this.pending.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.pending.set(
            key,
            setTimeout(() => {
                this.pending.delete(key);
                void this.refreshDocument(doc);
            }, 200),
        );
    }

    private async refreshDocument(doc: vscode.TextDocument): Promise<void> {
        const module = this.modules.resolveModule(doc.uri.fsPath);
        const loaded = module ? this.load(module) : null;
        if (!module || !loaded || loaded.findings.length === 0) {
            this.collection.delete(doc.uri);
            return;
        }
        const detected = await detectPreviews(doc, this.registry, this.log);
        const manifest = this.modules.readManifest(module);
        const diagnostics: vscode.Diagnostic[] = [];
        for (const det of detected) {
            const entry = this.registry.find(doc.uri.fsPath, det.functionName);
            if (!entry) {
                continue;
            }
            const findings = loaded.findings.filter((f) =>
                previewIdMatchesFunction(
                    f.previewId,
                    entry.preview.className,
                    det.functionName,
                ),
            );
            if (findings.length === 0) {
                continue;
            }
            const line = det.funLineNumber;
            const range = new vscode.Range(
                line,
                0,
                line,
                doc.lineAt(line).text.length,
            );
            for (const f of findings) {
                diagnostics.push(this.diagnostic(f, range, module, manifest));
            }
        }
        if (diagnostics.length === 0) {
            this.collection.delete(doc.uri);
        } else {
            this.collection.set(doc.uri, diagnostics);
        }
    }

    private diagnostic(
        finding: GuidelineFinding,
        range: vscode.Range,
        module: ModuleInfo,
        manifest: PreviewManifest | null,
    ): vscode.Diagnostic {
        const diag = new vscode.Diagnostic(
            range,
            findingMessage(finding),
            finding.severity === "info"
                ? vscode.DiagnosticSeverity.Information
                : vscode.DiagnosticSeverity.Warning,
        );
        diag.source = "compose-preview-guidelines";
        diag.code = finding.source
            ? {
                  value: finding.ruleId,
                  target: vscode.Uri.parse(finding.source),
              }
            : finding.ruleId;
        const annotated = this.annotatedRender(
            finding.previewId,
            module,
            manifest,
        );
        if (annotated) {
            diag.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                        vscode.Uri.file(annotated),
                        new vscode.Position(0, 0),
                    ),
                    "The render with this finding drawn on it",
                ),
            ];
        }
        return diag;
    }

    private annotatedRender(
        previewId: string,
        module: ModuleInfo,
        manifest: PreviewManifest | null,
    ): string | null {
        const capture = manifest?.previews
            .find((p) => p.id === previewId)
            ?.captures.find((c) => c.renderOutput);
        if (!capture) {
            return null;
        }
        const render = path.join(
            this.modules.workspaceRoot,
            module.projectDir,
            "build",
            "compose-previews",
            capture.renderOutput,
        );
        const annotated = annotatedPathFor(render);
        return fs.existsSync(annotated) ? annotated : null;
    }

    private load(module: ModuleInfo): { findings: GuidelineFinding[] } | null {
        const file = path.join(
            this.modules.workspaceRoot,
            module.projectDir,
            "build",
            "compose-previews",
            "guidelines.json",
        );
        let text: string;
        try {
            text = fs.readFileSync(file, "utf-8");
        } catch {
            return null;
        }
        const guidelines = parseModuleGuidelines(text);
        if (!guidelines) {
            this.log?.(
                `[guidelines] ${file} is not a guidelines report; ignored`,
            );
            return null;
        }
        return { findings: failingFindings(guidelines, this.rules(module)) };
    }

    /** The catalog's rules, for severity and the guide link; empty when no file is found. */
    private rules(module: ModuleInfo): Map<string, GuidelineRuleInfo> {
        for (const candidate of guidelinesFileCandidates(
            this.modules.workspaceRoot,
            module.projectDir,
        )) {
            try {
                return parseCatalogRules(fs.readFileSync(candidate, "utf-8"));
            } catch {
                /* try the next place */
            }
        }
        return new Map();
    }
}
