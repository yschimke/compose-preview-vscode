import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ModuleInfo } from "../gradleService";

/**
 * Remembers which `daemon-launch.json` contents this extension saw Gradle write, so the daemon is
 * only ever spawned from a descriptor produced by a `composePreviewDaemonStart` run the extension
 * itself started — never from one that merely exists in the workspace.
 *
 * The descriptor names the executable (`javaLauncher`), its arguments and its working directory,
 * and it lives under `build/`, which a repository can commit. A cloned repository carrying its own
 * `daemon-launch.json` must not get a process spawned from it just because a Kotlin file was
 * focused (GHSA-92fv-5fxv-7c5h). Gating on provenance rather than on the descriptor's fields is
 * deliberate: a real `java` with an attacker jar on `classpath` is as dangerous as `/bin/sh`, so no
 * field-level allowlist can close it.
 *
 * A descriptor Gradle rewrote outside the extension (a terminal `./gradlew` run) simply fails the
 * check once; the warm path then runs the bootstrap task, which records it.
 */
export interface DescriptorProvenanceStore {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

const STATE_KEY = "composePreview.producedDaemonDescriptors";

/** Content hashes keyed by absolute descriptor path. Persisted when a store is attached. */
let produced = new Map<string, string>();
let store: DescriptorProvenanceStore | undefined;

/**
 * Attaches persistence (the extension's `workspaceState`) so a descriptor recorded in an earlier
 * session is still trusted after a reload, keeping the cached-descriptor fast path.
 */
export function attachDescriptorProvenanceStore(
    s: DescriptorProvenanceStore | undefined,
): void {
    store = s;
    produced = new Map(
        Object.entries(s?.get<Record<string, string>>(STATE_KEY) ?? {}),
    );
}

export function descriptorPath(
    workspaceRoot: string,
    module: ModuleInfo,
): string {
    return path.join(
        workspaceRoot,
        module.projectDir,
        "build",
        "compose-previews",
        "daemon-launch.json",
    );
}

function hashOf(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Records the descriptor currently on disk as produced by the extension's own Gradle run. */
export function recordProducedDescriptor(
    workspaceRoot: string,
    module: ModuleInfo,
): void {
    const file = descriptorPath(workspaceRoot, module);
    let raw: string;
    try {
        raw = fs.readFileSync(file, "utf-8");
    } catch {
        return;
    }
    produced.set(file, hashOf(raw));
    void store?.update(STATE_KEY, Object.fromEntries(produced));
}

/** True iff [raw], read from [file], is a descriptor this extension saw Gradle produce. */
export function isProducedDescriptor(file: string, raw: string): boolean {
    return produced.get(file) === hashOf(raw);
}
