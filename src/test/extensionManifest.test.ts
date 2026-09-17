// Guards the two fields in package.json that decide whether VS Code will load
// this extension at all. Neither fails at compile time — the symptom is an
// editor silently refusing the extension, which no other test here can see —
// and one of them has already been got wrong once.
//
// Deliberately no `semver` dependency: it is not a direct dependency of this
// repository, and the two shapes being asserted are simple enough to read
// directly. Adding a package to assert a package manifest is backwards.

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
) as { engines: { vscode: string }; devDependencies: Record<string, string> };

function parts(version: string): number[] {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    assert.ok(match, `not a MAJOR.MINOR.PATCH version: ${version}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: string, b: string): number {
    const [left, right] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
}

describe("extension manifest", () => {
    // `engines.vscode` is a semver RANGE matched against the running editor,
    // not a version to pin. Renovate's `rangeStrategy: pin` pinned it to a bare
    // `1.135.0` in #11, which VS Code reads as "only 1.135.0"; the day stable
    // moved to 1.138.0 every editor refused to load the extension — "Extension
    // is not compatible with Code 1.138.0" — and CI's test host with it. A
    // range keeps the same floor and admits every later editor.
    it("declares a floor, not a single supported VS Code", () => {
        const range = manifest.engines.vscode;
        assert.ok(
            /^[\^>]/.test(range),
            `engines.vscode is "${range}" — a bare version is a pin, not a floor, and every VS Code newer than it refuses to load the extension. Use a caret range.`,
        );
    });

    // The other half of the same support-policy decision: typings newer than
    // the declared floor compile against APIs the oldest supported editor does
    // not have, and that failure lands on a user rather than in CI.
    it("does not type against APIs newer than the supported floor", () => {
        const floor = manifest.engines.vscode.replace(/^[\^~>=]+/, "");
        const types = manifest.devDependencies["@types/vscode"];
        assert.ok(
            compare(types, floor) <= 0,
            `@types/vscode ${types} is newer than the engines.vscode floor ${floor}; bumping the types alone compiles against APIs older editors lack`,
        );
    });
});
