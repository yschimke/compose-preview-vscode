import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    WHOLE_MODULE_MARKER,
    compileSourcesFor,
    resetIncrementalCacheOnce,
} from "../daemon/moduleSources";

describe("compileSourcesFor", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "module-sources-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function write(relative: string): string {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "package p\n");
        return file;
    }

    it("sends every Kotlin file of the module, not only the edited one", () => {
        const edited = write("src/main/kotlin/a/Edited.kt");
        const theme = write("src/main/java/a/Theme.kt");
        write("src/main/java/a/Legacy.java");

        const sources = compileSourcesFor(
            [
                path.join(root, "src/main/kotlin"),
                path.join(root, "src/main/java"),
            ],
            { modified: [edited], removed: [] },
        );

        assert.deepStrictEqual(sources, [theme, edited].sort());
    });

    it("leaves a removed file out of the sources", () => {
        const kept = write("src/main/kotlin/Kept.kt");
        const removed = path.join(root, "src/main/kotlin/Gone.kt");

        const sources = compileSourcesFor(
            [path.join(root, "src/main/kotlin")],
            {
                modified: [kept],
                removed: [removed],
            },
        );

        assert.deepStrictEqual(sources, [kept]);
    });

    it("skips a declared source set that does not exist", () => {
        const kept = write("src/main/kotlin/Kept.kt");

        const sources = compileSourcesFor(
            [
                path.join(root, "src/main/kotlin"),
                path.join(root, "src/debug/kotlin"),
            ],
            { modified: [kept], removed: [] },
        );

        assert.deepStrictEqual(sources, [kept]);
    });

    it("falls back to the change set when the descriptor has no source dirs", () => {
        const edited = write("src/main/kotlin/Edited.kt");

        assert.deepStrictEqual(
            compileSourcesFor(undefined, { modified: [edited], removed: [] }),
            [edited],
        );
    });
});

describe("resetIncrementalCacheOnce", () => {
    let buildDir: string;
    let workDir: string;

    beforeEach(() => {
        buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-build-"));
        workDir = path.join(
            buildDir,
            "compose-previews",
            "daemon-state",
            "bta-ic",
        );
        fs.mkdirSync(path.join(workDir, "ic", "caches"), { recursive: true });
        fs.mkdirSync(path.join(workDir, "cp-snapshots"));
    });

    afterEach(() => {
        fs.rmSync(buildDir, { recursive: true, force: true });
    });

    it("drops the incremental cache once and keeps the class-path snapshots", () => {
        assert.strictEqual(resetIncrementalCacheOnce(workDir, buildDir), true);
        assert.strictEqual(fs.existsSync(path.join(workDir, "ic")), false);
        assert.strictEqual(
            fs.existsSync(path.join(workDir, "cp-snapshots")),
            true,
        );
        assert.strictEqual(
            fs.existsSync(path.join(workDir, WHOLE_MODULE_MARKER)),
            true,
        );

        fs.mkdirSync(path.join(workDir, "ic"));
        assert.strictEqual(resetIncrementalCacheOnce(workDir, buildDir), false);
        assert.strictEqual(fs.existsSync(path.join(workDir, "ic")), true);
    });

    it("refuses a working dir outside the module's build dir", () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "elsewhere-"));
        fs.mkdirSync(path.join(outside, "ic"));
        try {
            assert.strictEqual(
                resetIncrementalCacheOnce(outside, buildDir),
                false,
            );
            assert.strictEqual(
                resetIncrementalCacheOnce(path.join(buildDir, ".."), buildDir),
                false,
            );
            assert.strictEqual(
                resetIncrementalCacheOnce(buildDir, buildDir),
                false,
            );
            assert.strictEqual(fs.existsSync(path.join(outside, "ic")), true);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
