import * as assert from "assert";
import {
    GradleFailureDetector,
    GradleTaskFailedError,
    asSentence,
} from "../gradleFailureDetector";

// Real failure from wear-os-samples/ComposeStarter, with Maven Central
// answering this machine's requests with a disguised 404.
const MARKER_NOT_FOUND = [
    "FAILURE: Build failed with an exception.",
    "",
    "* What went wrong:",
    "A problem occurred configuring root project 'ComposeStarter'.",
    "> Could not resolve all artifacts for configuration 'classpath'.",
    "   > Could not find ee.schimke.composeai.preview:ee.schimke.composeai.preview.gradle.plugin:2.74.0.",
    "     Searched in the following locations:",
    "       - https://plugins.gradle.org/m2/ee/schimke/composeai/preview/ee.schimke.composeai.preview.gradle.plugin/2.74.0/ee.schimke.composeai.preview.gradle.plugin-2.74.0.pom",
    "     Required by:",
    "         root project 'ComposeStarter'",
    "",
    "* Try:",
    "> Run with --stacktrace option to get the stack trace.",
    "",
    "BUILD FAILED in 28s",
    "",
].join("\n");

const NOT_FOUND_CAUSE =
    "Could not find ee.schimke.composeai.preview:ee.schimke.composeai.preview.gradle.plugin:2.74.0.";

describe("GradleFailureDetector", () => {
    it("keeps the innermost cause of the What went wrong block", () => {
        const d = new GradleFailureDetector();
        d.consume(MARKER_NOT_FOUND);
        d.end();
        assert.strictEqual(d.getRootCause(), NOT_FOUND_CAUSE);
    });

    it("ignores the `> Run with …` hints in the Try section", () => {
        const d = new GradleFailureDetector();
        d.consume(MARKER_NOT_FOUND);
        d.end();
        assert.ok(!d.getRootCause()!.startsWith("Run with"));
    });

    it("survives chunks that split mid-line", () => {
        const d = new GradleFailureDetector();
        for (let i = 0; i < MARKER_NOT_FOUND.length; i += 7) {
            d.consume(MARKER_NOT_FOUND.slice(i, i + 7));
        }
        d.end();
        assert.strictEqual(d.getRootCause(), NOT_FOUND_CAUSE);
    });

    it("falls back to the block's first line when nothing is nested", () => {
        const d = new GradleFailureDetector();
        d.consume(
            "* What went wrong:\r\nTask 'nope' not found in root project 'x'.\r\n\r\n* Try:\r\n",
        );
        d.end();
        assert.strictEqual(
            d.getRootCause(),
            "Task 'nope' not found in root project 'x'.",
        );
    });

    it("reads a block the stream ends inside", () => {
        const d = new GradleFailureDetector();
        d.consume("* What went wrong:\nSomething broke");
        d.end();
        assert.strictEqual(d.getRootCause(), "Something broke");
    });

    it("returns null when the output has no failure block", () => {
        const d = new GradleFailureDetector();
        d.consume("> Task :app:composePreviewApplied\nBUILD SUCCESSFUL\n");
        d.end();
        assert.strictEqual(d.getRootCause(), null);
    });

    it("truncates a very long cause", () => {
        const d = new GradleFailureDetector();
        d.consume(`* What went wrong:\n> ${"x".repeat(1000)}\n* Try:\n`);
        d.end();
        assert.strictEqual(d.getRootCause()!.length, 300);
        assert.ok(d.getRootCause()!.endsWith("…"));
    });
});

describe("GradleTaskFailedError", () => {
    it("names the root cause when there is one", () => {
        assert.strictEqual(
            new GradleTaskFailedError("composePreviewApplied", NOT_FOUND_CAUSE)
                .message,
            `Gradle task composePreviewApplied failed: ${NOT_FOUND_CAUSE} See Output > Compose Preview.`,
        );
    });

    it("keeps the old message without one", () => {
        assert.strictEqual(
            new GradleTaskFailedError("composePreviewApplied", null).message,
            "Gradle task composePreviewApplied failed. See Output > Compose Preview.",
        );
    });
});

describe("asSentence", () => {
    it("adds a full stop only when missing", () => {
        assert.strictEqual(
            asSentence("timed out after 1200s"),
            "timed out after 1200s.",
        );
        assert.strictEqual(
            asSentence("Could not find x."),
            "Could not find x.",
        );
    });
});
