import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BundleCliNotFoundError, locateBundleCli } from "./bundleRender";
import type { GuidelinesModuleSource } from "./previewGuidelinesDiagnostics";
import { GuidelinesKeyStore } from "./guidelinesKey";
import type { ModuleInfo } from "./gradleService";
import {
    GuidelinesRunSummary,
    failingFindings,
    parseModuleGuidelines,
    guidelinesCliArgs,
    guidelinesCliEnv,
    guidelinesFileCandidates,
    parseGuidelinesSummary,
} from "./guidelinesResults";

/**
 * "Compose Preview: Check design guidelines": runs `compose-preview guidelines` (compose-ai-tools
 * 2.38.0+) for the module of the active Kotlin file — narrowed to that file's previews when one
 * is open — with `--annotate`, so the Problems panel ([PreviewGuidelinesDiagnostics], which
 * watches the `guidelines.json` it writes) and the annotated renders update when it finishes.
 *
 * [bootstrap] writes the `composePreviewApplied` markers first, as Refresh and Render do: on a
 * module that gets the plugin by the extension's injection, nothing else tells [resolveModule]
 * it has previews until the preview view has opened once.
 */
export async function checkDesignGuidelines(
    modules: GuidelinesModuleSource,
    keys: GuidelinesKeyStore,
    onFinished: () => void,
    log: (msg: string) => void,
    bootstrap: () => Promise<unknown> = async () => undefined,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(
        "composePreview.guidelines",
    );
    if (!config.get<boolean>("enabled", true)) {
        void vscode.window.showInformationMessage(
            "The design-guidelines check is turned off (composePreview.guidelines.enabled).",
        );
        return;
    }
    const editor = vscode.window.activeTextEditor;
    const file = editor?.document.uri.fsPath;
    await bootstrap();
    const module = file ? modules.resolveModule(file) : null;
    if (!module) {
        void vscode.window.showWarningMessage(
            "Open a Kotlin file in a module with Compose previews to check its design guidelines.",
        );
        return;
    }
    const key = (await keys.get()) ?? (await keys.prompt());
    if (!key) {
        return;
    }
    let cliPath: string;
    try {
        cliPath = await locateBundleCli();
    } catch (e) {
        const message =
            e instanceof BundleCliNotFoundError
                ? e.message
                : (e as Error).message;
        void vscode.window.showErrorMessage(message);
        return;
    }
    const guidelinesFile = guidelinesFileCandidates(
        modules.workspaceRoot,
        module.projectDir,
    ).find((p) => fs.existsSync(p));
    const args = guidelinesCliArgs({
        modulePath: module.modulePath,
        filter:
            editor?.document.languageId === "kotlin" && file
                ? path.basename(file, path.extname(file))
                : null,
        model: config.get<string>("model", "deepseek/deepseek-v4.1-flash"),
        maxCost: config.get<number>("maxCost", 0.1),
        // The plugin's own copy is found by the CLI; only a committed file needs naming.
        guidelinesFile:
            guidelinesFile &&
            !guidelinesFile.includes(`${path.sep}build${path.sep}`)
                ? guidelinesFile
                : null,
        surface:
            config.get<string>("surface", "auto") === "auto"
                ? null
                : (config.get<string>("surface") ?? null),
    });
    log(`[guidelines] ${cliPath} ${args.join(" ")}`);
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Checking design guidelines",
            cancellable: true,
        },
        async (progress, token) => {
            const result = await run(cliPath, args, {
                cwd: modules.workspaceRoot,
                env: guidelinesCliEnv(process.env, key),
                token,
                onOutput: (line) => {
                    log(`[guidelines] ${line}`);
                    if (/preview\(s\) checked|render|request/.test(line)) {
                        progress.report({ message: line.slice(0, 120) });
                    }
                },
            });
            onFinished();
            if (result.cancelled) {
                return;
            }
            if (result.summaries.length === 0) {
                void vscode.window.showErrorMessage(
                    `The design-guidelines check did not finish (exit ${result.code}). ` +
                        "See the Compose Preview output for details.",
                );
                return;
            }
            void vscode.window.showInformationMessage(
                summarise(result.summaries, countProblems(modules, module)),
            );
        },
    );
}

function summarise(
    summaries: GuidelinesRunSummary[],
    problems: number,
): string {
    const previews = summaries.reduce((n, s) => n + s.previews, 0);
    const cost = summaries.reduce((n, s) => n + s.costUsd, 0);
    const found =
        problems === 0
            ? "No guideline looks broken."
            : `${problems} finding(s) are in the Problems panel.`;
    return `Checked ${previews} preview(s) against their design guidelines for $${cost.toFixed(4)}. ${found}`;
}

/** The module's failing verdicts after a run, from the `guidelines.json` the CLI wrote. */
function countProblems(
    modules: GuidelinesModuleSource,
    module: ModuleInfo,
): number {
    try {
        const parsed = parseModuleGuidelines(
            fs.readFileSync(
                path.join(
                    modules.workspaceRoot,
                    module.projectDir,
                    "build",
                    "compose-previews",
                    "guidelines.json",
                ),
                "utf-8",
            ),
        );
        return parsed ? failingFindings(parsed, new Map()).length : 0;
    } catch {
        return 0;
    }
}

interface RunResult {
    code: number | null;
    cancelled: boolean;
    summaries: GuidelinesRunSummary[];
}

function run(
    cliPath: string,
    args: string[],
    opts: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        token: vscode.CancellationToken;
        onOutput: (line: string) => void;
    },
): Promise<RunResult> {
    return new Promise((resolve) => {
        const proc = spawn(cliPath, args, {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let cancelled = false;
        const cancel = opts.token.onCancellationRequested(() => {
            cancelled = true;
            proc.kill("SIGTERM");
        });
        let stdout = "";
        const feed = (chunk: Buffer, keep: boolean) => {
            const text = chunk.toString("utf-8");
            if (keep) stdout += text;
            for (const line of text.split(/\r?\n/)) {
                if (line.trim()) opts.onOutput(line);
            }
        };
        proc.stdout.on("data", (c: Buffer) => feed(c, true));
        proc.stderr.on("data", (c: Buffer) => feed(c, false));
        proc.on("error", (err) => {
            cancel.dispose();
            opts.onOutput(`could not start the CLI: ${err.message}`);
            resolve({ code: null, cancelled, summaries: [] });
        });
        proc.on("close", (code) => {
            cancel.dispose();
            resolve({
                code,
                cancelled,
                summaries: parseGuidelinesSummary(stdout),
            });
        });
    });
}
