#!/usr/bin/env node
//
// Proves the spike's own instruments before trusting what they say about the
// editor: that the nonce rewriting lets a legitimate script run, that the
// baseline CSP still blocks an un-nonced one, and that `paintStats` can tell a
// painted canvas from a blank page. Without this, "PAINTS: no" is ambiguous
// between the editor and the harness.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { startHost } from "./host.mjs";
import { decodePng, paintStats } from "./png.mjs";

const PAINTING = `<!doctype html>
<html><head><style>html,body{margin:0}</style></head>
<body><div id="composeApp"></div>
<script type="module">
  const canvas = document.createElement("canvas");
  canvas.width = 400; canvas.height = 300;
  const context = canvas.getContext("2d");
  for (let i = 0; i < 400; i += 1) {
    context.fillStyle = \`hsl(\${i} 80% 50%)\`;
    context.fillRect(i, 0, 1, 300);
  }
  document.getElementById("composeApp").append(canvas);
  globalThis.__ran = true;
</script>
</body></html>`;

const BLANK = `<!doctype html><html><head><style>html,body{margin:0;background:#fff}</style></head><body></body></html>`;

const root = await mkdtemp(join(tmpdir(), "spike-selftest-"));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--headless=new"],
});

async function load(html, cspName) {
    await writeFile(join(root, "index.html"), html);
    const host = await startHost({ root, cspName });
    const page = await browser.newPage({
        viewport: { width: 400, height: 300 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(host.url, { waitUntil: "load" });
    await page.waitForTimeout(500);
    const ran = await page.evaluate(() => globalThis.__ran === true);
    const stats = paintStats(decodePng(await page.screenshot()));
    await page.close();
    await host.close();
    return { ran, stats, errors };
}

const failures = [];
function check(name, ok, detail) {
    console.log(
        `${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
    if (!ok) failures.push(name);
}

const painted = await load(PAINTING, "predicted");
check(
    "a nonced module script runs under the widened CSP",
    painted.ran,
    painted.errors.join("; "),
);
check(
    "paintStats sees a painted canvas",
    painted.stats.distinctColours > 100,
    `${painted.stats.distinctColours} colours`,
);

const blank = await load(BLANK, "predicted");
check(
    "paintStats sees a blank page as blank",
    blank.stats.distinctColours <= 2 && blank.stats.nonWhiteFraction < 0.01,
    `${blank.stats.distinctColours} colours, ${blank.stats.nonWhiteFraction.toFixed(4)} non-white`,
);

// The un-nonced control: strip the harness's nonce injection by pre-setting a
// wrong nonce, which is what an inline script the extension forgot looks like.
const unnonced = await load(
    PAINTING.replace(
        '<script type="module">',
        '<script nonce="wrong" type="module">',
    ),
    "baseline",
);
check(
    "the baseline CSP blocks a script whose nonce does not match",
    !unnonced.ran,
    unnonced.errors.join("; ") || "no page error, script simply did not run",
);

await browser.close();
await rm(root, { recursive: true, force: true });

if (failures.length > 0) {
    console.error(`\n${failures.length} self-check(s) failed`);
    process.exitCode = 1;
} else {
    console.log("\nself-checks pass: the instruments are sound");
}
