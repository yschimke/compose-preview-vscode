import * as fs from "fs";
import * as path from "path";
import { SourceChangeSet } from "./daemonProtocol";

/**
 * The `sources` of a `compileSources` request: every Kotlin file of the module plus the
 * change set's modified files, without its removed ones.
 *
 * The daemon's Build Tools API compile builds exactly `sources`. Kotlin's incremental
 * compile needs the whole module there and the change set to say which files changed;
 * given only the edited file, it rebuilds that file alone, which then cannot resolve
 * anything else in the module ("Unresolved reference"). That compile is the daemon's
 * fallback whenever its warm compiler declines an edit — an ABI change, a new file — so
 * it ran on ordinary edits like adding a function. A removed file belongs only in the
 * change set: passed as a source, the compile fails on the missing path.
 *
 * [sourceDirs] is the module's `sourceWatch.sourceDirs` from `daemon-launch.json`; a
 * descriptor written before that field gives none, and then only the change set is sent.
 */
export function compileSourcesFor(
    sourceDirs: readonly string[] | undefined,
    changes: SourceChangeSet,
): string[] {
    const removed = new Set(changes.removed);
    const all = new Set<string>();
    for (const dir of sourceDirs ?? []) {
        for (const file of kotlinFilesUnder(dir)) all.add(file);
    }
    for (const file of changes.modified) all.add(file);
    return [...all].filter((file) => !removed.has(file)).sort();
}

function kotlinFilesUnder(dir: string): string[] {
    const found: string[] = [];
    const pending = [dir];
    while (pending.length > 0) {
        const current = pending.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue; // A source set the module declares but does not have.
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) pending.push(full);
            else if (entry.isFile() && entry.name.endsWith(".kt"))
                found.push(full);
        }
    }
    return found;
}

/**
 * Name of the marker [resetIncrementalCacheOnce] leaves in a module's BTA working dir once
 * its incremental cache has been rebuilt from whole-module sources.
 */
export const WHOLE_MODULE_MARKER = "whole-module-sources";

/**
 * Drops the Build Tools API incremental cache under [icWorkingDir] once, the first time this
 * extension sends a module's whole source set.
 *
 * Earlier versions sent only the edited file. With no change set, that compile rebuilt the
 * one file and deleted every other class of the module from the output dir; its cache then
 * records a one-file module, so later compiles never restore them and fail to resolve
 * anything else in the module. Removing `ic/` makes the next compile, sent without a change
 * set, rebuild the whole module and its cache (the class-path snapshots beside it stay
 * valid). The marker keeps this to once per working dir. Returns whether it reset.
 */
export function resetIncrementalCacheOnce(icWorkingDir: string): boolean {
    const marker = path.join(icWorkingDir, WHOLE_MODULE_MARKER);
    if (fs.existsSync(marker)) return false;
    try {
        fs.rmSync(path.join(icWorkingDir, "ic"), {
            recursive: true,
            force: true,
        });
        fs.mkdirSync(icWorkingDir, { recursive: true });
        fs.writeFileSync(marker, "");
        return true;
    } catch {
        return false;
    }
}
