// Pure helpers for the design-guidelines check (`compose-preview guidelines`, compose-ai-tools
// 2.38.0+): reading the per-module `build/compose-previews/guidelines.json` it writes, deciding
// which verdicts are problems, and building the CLI invocation. No `vscode` import, so all of it
// is unit-testable from plain mocha; `previewGuidelinesDiagnostics.ts` and `guidelinesCheck.ts`
// are the thin VS Code halves.

import * as path from "path";

/** One verdict, as `GuidelineVerdictV1` in compose-preview-contracts' design-guidelines-protocol. */
export interface GuidelineVerdict {
    ruleId: string;
    /** `pass`, `fail`, `not_applicable` or `needs_evidence`. */
    verdict: string;
    confidence?: number;
    nodeIds?: string[];
    reason?: string;
    subjectId?: string;
}

/** `GuidelineRecordV1`: one preview's verdicts, and which model answered at what cost. */
export interface GuidelineRecord {
    previewId?: string;
    model?: string;
    rulesVersion?: number;
    verdicts?: GuidelineVerdict[];
    servedModel?: string;
    provider?: string;
    costUsd?: number;
}

/** `PreviewGuidelineResult` in compose-ai-tools' design-guidelines engine. */
export interface PreviewGuidelineResult {
    previewId: string;
    renderHash?: string;
    record: GuidelineRecord;
    /** Rules still `needs_evidence` after the last round: unchecked, not passed. */
    unchecked?: string[];
    fromCache?: boolean;
}

/** The CLI's `build/compose-previews/guidelines.json` (`ModuleGuidelines`). */
export interface ModuleGuidelines {
    module?: string;
    catalog?: string;
    model?: string;
    results: PreviewGuidelineResult[];
}

/** The parts of a catalog rule (`ui-builder.guidelines.json`) the Problems panel shows. */
export interface GuidelineRuleInfo {
    id: string;
    severity?: string;
    guidance?: string;
    source?: string;
}

/** One problem to show: a failing verdict, joined to its rule. */
export interface GuidelineFinding {
    previewId: string;
    ruleId: string;
    reason: string;
    /** 0..100, rounded. */
    confidencePercent: number | null;
    /** `warning` or `info`, from the catalog rule; `warning` when the rule is unknown. */
    severity: "warning" | "info";
    /** The guide the rule quotes, when the catalog file was found. */
    source: string | null;
    nodeIds: string[];
}

/** Parses a `guidelines.json`; null when it is not one. */
export function parseModuleGuidelines(text: string): ModuleGuidelines | null {
    try {
        const parsed = JSON.parse(text) as Partial<ModuleGuidelines>;
        if (!parsed || !Array.isArray(parsed.results)) {
            return null;
        }
        return {
            module: parsed.module,
            catalog: parsed.catalog,
            model: parsed.model,
            results: parsed.results.filter(
                (r): r is PreviewGuidelineResult =>
                    !!r && typeof r.previewId === "string" && !!r.record,
            ),
        };
    } catch {
        return null;
    }
}

/** The rules of a catalog's `ui-builder.guidelines.json`, by id; empty when unreadable. */
export function parseCatalogRules(
    text: string,
): Map<string, GuidelineRuleInfo> {
    const rules = new Map<string, GuidelineRuleInfo>();
    try {
        const parsed = JSON.parse(text) as { rules?: GuidelineRuleInfo[] };
        for (const rule of parsed.rules ?? []) {
            if (rule && typeof rule.id === "string") {
                rules.set(rule.id, rule);
            }
        }
    } catch {
        /* no rules: findings fall back to warning severity and no link */
    }
    return rules;
}

/**
 * The problems in [guidelines]: every `fail` verdict. `pass`, `not_applicable` and
 * `needs_evidence` are not problems, and neither are rules left unchecked; a model that could
 * not decide has found nothing.
 */
export function failingFindings(
    guidelines: ModuleGuidelines,
    rules: Map<string, GuidelineRuleInfo>,
): GuidelineFinding[] {
    const findings: GuidelineFinding[] = [];
    for (const result of guidelines.results) {
        for (const v of result.record.verdicts ?? []) {
            if (v.verdict !== "fail") {
                continue;
            }
            // In a batched record a verdict may name another subject; it belongs to that one.
            if (v.subjectId && v.subjectId !== result.previewId) {
                continue;
            }
            const rule = rules.get(v.ruleId);
            findings.push({
                previewId: result.previewId,
                ruleId: v.ruleId,
                reason: (v.reason ?? "").trim(),
                confidencePercent:
                    typeof v.confidence === "number"
                        ? Math.round(v.confidence * 100)
                        : null,
                severity: rule?.severity === "info" ? "info" : "warning",
                source:
                    rule?.source && /^https?:\/\//.test(rule.source)
                        ? rule.source
                        : null,
                nodeIds: v.nodeIds ?? [],
            });
        }
    }
    return findings;
}

/**
 * Whether [previewId] is a preview of the function [functionName] in [className]. A function
 * with several `@Preview`s, or a device sweep, gets ids `<className>.<functionName>_<suffix>`.
 */
export function previewIdMatchesFunction(
    previewId: string,
    className: string,
    functionName: string,
): boolean {
    const base = `${className}.${functionName}`;
    return previewId === base || previewId.startsWith(`${base}_`);
}

/** The Problems-panel message for [finding]. */
export function findingMessage(finding: GuidelineFinding): string {
    const confidence =
        finding.confidencePercent === null
            ? ""
            : ` (${finding.confidencePercent}% sure)`;
    const reason = finding.reason || "The model judged this guideline broken.";
    return `${reason}${confidence} [${finding.previewId}]`;
}

/** `<render>.guidelines.png`: where `--annotate` draws a preview's findings beside its render. */
export function annotatedPathFor(renderPath: string): string {
    const ext = path.extname(renderPath);
    return (
        renderPath.slice(0, renderPath.length - ext.length) + ".guidelines.png"
    );
}

/** Settings and target of one check run. */
export interface GuidelinesRunOptions {
    /** Gradle path of the module, e.g. `:catalog`. */
    modulePath: string;
    /** Narrows the run to one source file's previews; null checks the whole module. */
    filter: string | null;
    model: string;
    maxCost: number;
    /** The catalog's `ui-builder.guidelines.json`, when the build does not carry its own copy. */
    guidelinesFile: string | null;
    /** `screen`, `widget` or `component`; null lets the CLI decide per preview. */
    surface: string | null;
}

/** The CLI arguments for a check. The key is never among them: see [guidelinesCliEnv]. */
export function guidelinesCliArgs(opts: GuidelinesRunOptions): string[] {
    const args = [
        "guidelines",
        "--module",
        opts.modulePath,
        "--annotate",
        "--model",
        opts.model,
        "--max-cost",
        String(opts.maxCost),
    ];
    if (opts.filter) {
        args.push("--filter", opts.filter);
    }
    if (opts.guidelinesFile) {
        args.push("--guidelines", opts.guidelinesFile);
    }
    if (opts.surface) {
        args.push("--surface", opts.surface);
    }
    return args;
}

/** The environment variable the CLI reads its OpenRouter key from. */
export const OPENROUTER_KEY_ENV = "COMPOSE_PREVIEW_OPENROUTER_KEY";

/**
 * [base] with the OpenRouter key added. The key travels only through the subprocess
 * environment, never on the command line, where any process listing would show it.
 */
export function guidelinesCliEnv(
    base: NodeJS.ProcessEnv,
    key: string,
): NodeJS.ProcessEnv {
    return { ...base, [OPENROUTER_KEY_ENV]: key };
}

/** What the CLI reported for one module. */
export interface GuidelinesRunSummary {
    module: string;
    previews: number;
    requests: number;
    costUsd: number;
}

/**
 * The summary lines the CLI prints, one per module:
 * `catalog: 5 preview(s) checked against `wear-m3` guidelines v1 — 1 request(s), $0.0427`.
 */
export function parseGuidelinesSummary(stdout: string): GuidelinesRunSummary[] {
    const summaries: GuidelinesRunSummary[] = [];
    const pattern =
        /^(\S+): (\d+) preview\(s\) checked against .*? — (\d+) request\(s\), \$([0-9.]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stdout)) !== null) {
        summaries.push({
            module: match[1],
            previews: Number(match[2]),
            requests: Number(match[3]),
            costUsd: Number(match[4]),
        });
    }
    return summaries;
}

/**
 * Where a module's catalog guidelines may be, best first: the copy the Gradle plugin (2.38.0+)
 * writes beside `guidelines.json`, then a `ui-builder.guidelines.json` committed in the module or
 * at the workspace root, where a catalog authors it.
 */
export function guidelinesFileCandidates(
    workspaceRoot: string,
    moduleDir: string,
): string[] {
    const name = "ui-builder.guidelines.json";
    return [
        path.join(workspaceRoot, moduleDir, "build", "compose-previews", name),
        path.join(workspaceRoot, moduleDir, name),
        path.join(workspaceRoot, name),
    ];
}
