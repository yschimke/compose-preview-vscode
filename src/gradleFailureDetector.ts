/**
 * Scans Gradle output for the `* What went wrong:` block of a failed build and
 * keeps its innermost cause — the line a user needs, which Gradle nests under
 * one or more wrappers:
 *
 *     * What went wrong:
 *     A problem occurred configuring root project 'ComposeStarter'.
 *     > Could not resolve all artifacts for configuration 'classpath'.
 *        > Could not find ee.schimke.composeai.preview:ee.schimke.composeai.preview.gradle.plugin:2.74.0.
 *          Searched in the following locations:
 *
 * yields `Could not find ee.schimke.composeai.preview:…:2.74.0.`. With no `>`
 * lines the block's first line is the cause. Only the first block is read; a
 * multi-failure build lists the earliest failure first.
 *
 * Feed each `onOutput` chunk through {@link consume}. At the end of the build
 * read {@link getRootCause}; it returns `null` unless a block was seen.
 */

const MAX_CAUSE_LENGTH = 300;

/** Ends a cause with a full stop unless it already ends a sentence. */
export function asSentence(cause: string): string {
    return /[.!?…]$/.test(cause) ? cause : `${cause}.`;
}

const CAUSE_RE = /^(\s*)> (.+)$/;

export class GradleFailureDetector {
    private buffer = "";
    private inBlock = false;
    private done = false;
    private firstLine: string | null = null;
    private deepest: { depth: number; text: string } | null = null;

    /**
     * Accept a chunk of decoded stdout/stderr. Safe to call with partial
     * lines — they're buffered until a newline arrives.
     */
    consume(chunk: string): void {
        if (this.done) {
            return;
        }
        this.buffer += chunk;
        let nl = this.buffer.indexOf("\n");
        while (nl !== -1 && !this.done) {
            this.scanLine(this.buffer.slice(0, nl).replace(/\r$/, ""));
            this.buffer = this.buffer.slice(nl + 1);
            nl = this.buffer.indexOf("\n");
        }
        // Same 16 KiB bound as the other detectors.
        if (this.buffer.length > 16 * 1024) {
            this.scanLine(this.buffer);
            this.buffer = "";
        }
    }

    /** Flush the residual buffer. Call once after the stream ends. */
    end(): void {
        if (!this.done && this.buffer.length > 0) {
            this.scanLine(this.buffer);
        }
        this.buffer = "";
        if (this.inBlock) {
            this.inBlock = false;
            this.done = true;
        }
    }

    getRootCause(): string | null {
        const cause = this.deepest?.text ?? this.firstLine;
        if (!cause) {
            return null;
        }
        return cause.length > MAX_CAUSE_LENGTH
            ? `${cause.slice(0, MAX_CAUSE_LENGTH - 1)}…`
            : cause;
    }

    private scanLine(line: string): void {
        if (!this.inBlock) {
            if (line.trim() === "* What went wrong:") {
                this.inBlock = true;
            }
            return;
        }
        // The next section (`* Try:`, `* Exception is:`) closes the block.
        if (line.startsWith("* ")) {
            this.inBlock = false;
            this.done = true;
            return;
        }
        const m = CAUSE_RE.exec(line);
        if (m) {
            const depth = m[1].length;
            if (!this.deepest || depth > this.deepest.depth) {
                this.deepest = { depth, text: m[2].trim() };
            }
            return;
        }
        if (this.firstLine === null && line.trim().length > 0) {
            this.firstLine = line.trim();
        }
    }
}

/**
 * Thrown by {@link GradleService} when a task failed for a reason none of the
 * typed detectors recognised. Carries Gradle's own root-cause line, when the
 * output had one, so the panel and notifications can say what went wrong
 * instead of only pointing at the output channel.
 */
export class GradleTaskFailedError extends Error {
    constructor(
        readonly task: string,
        readonly rootCause: string | null,
    ) {
        super(
            rootCause
                ? `Gradle task ${task} failed: ${asSentence(rootCause)} See Output > Compose Preview.`
                : `Gradle task ${task} failed. See Output > Compose Preview.`,
        );
        this.name = "GradleTaskFailedError";
    }
}
