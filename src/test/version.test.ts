import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { BUNDLED_DAEMON_VERSION } from "../version.generated";
import { majorVersionOf, versionsIncompatible } from "../version";

describe("version compatibility", () => {
    it("generates the daemon version from the committed pin", () => {
        const pin = JSON.parse(
            fs.readFileSync(
                path.resolve(__dirname, "../../plugin-version.json"),
                "utf8",
            ),
        ) as { composePreviewDaemon: string };
        assert.strictEqual(BUNDLED_DAEMON_VERSION, pin.composePreviewDaemon);
    });
    it("reads the major as the first numeric segment", () => {
        assert.strictEqual(majorVersionOf("0.12.5"), 0);
        assert.strictEqual(majorVersionOf("1.2.3"), 1);
        assert.strictEqual(majorVersionOf("v2.0.0-SNAPSHOT"), 2);
        assert.strictEqual(majorVersionOf("12.0.0"), 12);
    });

    it("returns null for unparseable versions", () => {
        assert.strictEqual(majorVersionOf("main"), null);
        assert.strictEqual(majorVersionOf(""), null);
        assert.strictEqual(majorVersionOf("-SNAPSHOT"), null);
    });

    it("treats same-major as compatible regardless of minor/patch", () => {
        assert.strictEqual(versionsIncompatible("1.2.3", "1.9.0"), false);
        assert.strictEqual(versionsIncompatible("0.12.5", "0.8.0"), false);
        assert.strictEqual(
            versionsIncompatible("2.0.0-SNAPSHOT", "2.3.1"),
            false,
        );
    });

    it("treats different-major as incompatible", () => {
        assert.strictEqual(versionsIncompatible("1.0.0", "2.0.0"), true);
        assert.strictEqual(versionsIncompatible("0.12.5", "1.0.0"), true);
    });

    it("never warns when a version is unparseable", () => {
        assert.strictEqual(versionsIncompatible("main", "1.0.0"), false);
        assert.strictEqual(versionsIncompatible("1.0.0", ""), false);
    });
});
