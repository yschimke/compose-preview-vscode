import { SourceChangeSet } from "./daemonProtocol";

/**
 * Kotlin sources changed since a module's last successful in-process compile.
 *
 * `compileSources` declares its change set to the daemon, and the daemon's warm compiler
 * recompiles exactly that set. A save only names the file it refreshes for — the refresh
 * queue keeps the latest target of a burst — so the set is accumulated here from every
 * save and file-system event instead, and cleared only by a compile that succeeded.
 */
export class PendingSourceChanges {
    /** Per module: path → its latest change and a version that grows with every record. */
    private readonly pending = new Map<string, Map<string, Entry>>();
    private nextVersion = 0;

    /** Records [path] as modified (saved, created, changed on disk) in [moduleKey]. */
    recordModified(moduleKey: string, path: string): void {
        this.record(moduleKey, path, false);
    }

    /** Records [path] as deleted from [moduleKey]. */
    recordRemoved(moduleKey: string, path: string): void {
        this.record(moduleKey, path, true);
    }

    /**
     * What a compile of [moduleKey] should declare, or `undefined` when no Kotlin source is
     * pending (the daemon then works the changes out itself). Pass it back to [clear] once
     * that compile has succeeded.
     */
    snapshot(moduleKey: string): PendingSnapshot | undefined {
        const entries = this.pending.get(moduleKey);
        if (!entries || entries.size === 0) return undefined;
        const changes: SourceChangeSet = { modified: [], removed: [] };
        const versions = new Map<string, number>();
        for (const [path, entry] of entries) {
            (entry.removed ? changes.removed : changes.modified).push(path);
            versions.set(path, entry.version);
        }
        return { changes, versions };
    }

    /**
     * Drops what a successful compile covered. A path recorded again after [taken] keeps
     * its newer entry: the compile may have read the file before that change was written.
     */
    clear(moduleKey: string, taken: PendingSnapshot): void {
        const entries = this.pending.get(moduleKey);
        if (!entries) return;
        for (const [path, version] of taken.versions) {
            if (entries.get(path)?.version === version) entries.delete(path);
        }
    }

    private record(moduleKey: string, path: string, removed: boolean): void {
        if (!path.endsWith(".kt")) return;
        let entries = this.pending.get(moduleKey);
        if (!entries) {
            entries = new Map();
            this.pending.set(moduleKey, entries);
        }
        entries.set(path, { removed, version: this.nextVersion++ });
    }
}

export interface PendingSnapshot {
    changes: SourceChangeSet;
    versions: ReadonlyMap<string, number>;
}

interface Entry {
    removed: boolean;
    version: number;
}
