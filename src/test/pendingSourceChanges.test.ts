import * as assert from "assert";
import { PendingSourceChanges } from "../daemon/pendingSourceChanges";

describe("PendingSourceChanges", () => {
    it("declares every Kotlin file saved in a burst, not only the last", () => {
        const pending = new PendingSourceChanges();
        pending.recordModified(":app", "/a/A.kt");
        pending.recordModified(":app", "/a/B.kt");

        assert.deepStrictEqual(pending.snapshot(":app")?.changes, {
            modified: ["/a/A.kt", "/a/B.kt"],
            removed: [],
        });
    });

    it("reports a deletion as removed, and a re-creation as modified", () => {
        const pending = new PendingSourceChanges();
        pending.recordModified(":app", "/a/A.kt");
        pending.recordRemoved(":app", "/a/A.kt");
        assert.deepStrictEqual(pending.snapshot(":app")?.changes, {
            modified: [],
            removed: ["/a/A.kt"],
        });

        pending.recordModified(":app", "/a/A.kt");
        assert.deepStrictEqual(pending.snapshot(":app")?.changes, {
            modified: ["/a/A.kt"],
            removed: [],
        });
    });

    it("keeps modules apart and ignores non-Kotlin files", () => {
        const pending = new PendingSourceChanges();
        pending.recordModified(":app", "/a/A.kt");
        pending.recordModified(":lib", "/l/res/values/strings.xml");

        assert.strictEqual(pending.snapshot(":lib"), undefined);
        assert.deepStrictEqual(pending.snapshot(":app")?.changes.modified, [
            "/a/A.kt",
        ]);
    });

    it("clears what a successful compile covered", () => {
        const pending = new PendingSourceChanges();
        pending.recordModified(":app", "/a/A.kt");
        const taken = pending.snapshot(":app")!;

        pending.clear(":app", taken);

        assert.strictEqual(pending.snapshot(":app"), undefined);
    });

    it("keeps a file saved again while the compile ran", () => {
        const pending = new PendingSourceChanges();
        pending.recordModified(":app", "/a/A.kt");
        pending.recordModified(":app", "/a/B.kt");
        const taken = pending.snapshot(":app")!;
        pending.recordModified(":app", "/a/A.kt");

        pending.clear(":app", taken);

        assert.deepStrictEqual(pending.snapshot(":app")?.changes, {
            modified: ["/a/A.kt"],
            removed: [],
        });
    });
});
