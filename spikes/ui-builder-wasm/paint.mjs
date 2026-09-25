#!/usr/bin/env node
//
// The spike: does the Kotlin/Wasm UI builder paint under a VS Code webview's CSP?
//
// Usage: node paint.mjs [--csp=predicted|baseline|none] [--timeout=ms] [--keep]
//
// Answers by loading the real published archive in Chromium with the webview's
// HTML shape, then reading the page back: every CSP violation the document
// reports, every console error, whether a canvas exists, and whether anything
// was painted into it.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { startHost } from "./host.mjs";
import { decodePng, paintStats } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "out/dist");
const captures = resolve(here, "out/captures");

function flag(name, fallback) {
    const match = process.argv.find((argument) =>
        argument.startsWith(`--${name}=`),
    );
    return match ? match.slice(name.length + 3) : fallback;
}

const cspName = flag("csp", "predicted");
const timeout = Number(flag("timeout", "120000"));
// The webview's engine is Electron's Chromium, so the spike wants a real
// Chromium rather than the headless shell — Skiko needs WebGL, which the shell
// does not carry. CHROMIUM_PATH covers a sandbox whose installed build does not
// match the pinned Playwright's expectation.
const executablePath = process.env.CHROMIUM_PATH || undefined;

const host = await startHost({ root: dist, cspName });
const browser = await chromium.launch({
    executablePath,
    args: [
        "--no-sandbox",
        "--headless=new",
        "--enable-unsafe-webgpu",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
    ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(timeout);
page.setDefaultNavigationTimeout(timeout);

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const violations = [];

page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()} — ${request.failure()?.errorText}`),
);
await page.addInitScript(() => {
    globalThis.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
        globalThis.__cspViolations.push({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            sample: event.sample,
        });
    });
});

console.log(`csp (${cspName}): ${host.csp ?? "(none)"}`);
console.log(`loading ${host.url}`);

const started = Date.now();
let painted = null;
let canvas = null;

// A Wasm module this size can take minutes to compile on a small machine, and a
// spike that hangs without saying where is no better than no spike. Every phase
// announces itself.
function stage(message) {
    console.log(`[+${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
}

try {
    stage("goto");
    await page.goto(host.url, { waitUntil: "domcontentloaded", timeout });
    stage("dom ready; waiting for the Compose canvas");

    // The editor mounts a canvas into #composeApp once Skiko is up. Waiting on
    // the canvas separates "the module never ran" from "it ran and drew nothing".
    try {
        await page.waitForSelector("#composeApp canvas", { timeout });
        canvas = await page.$eval("#composeApp canvas", (element) => ({
            width: element.width,
            height: element.height,
        }));
        stage(`canvas ${canvas.width}x${canvas.height}`);
    } catch {
        canvas = null;
        stage("no canvas within the timeout");
    }

    if (canvas) {
        // Compose keeps drawing after the first frame; give it a beat so the
        // capture is the editor rather than its first paint.
        await page.waitForTimeout(3000);
    }
    stage("screenshot");

    await mkdir(captures, { recursive: true });
    const shot = await page.screenshot({
        timeout: 60_000,
        animations: "disabled",
    });
    await writeFile(resolve(captures, `${cspName}.png`), shot);
    painted = paintStats(decodePng(shot));
    stage(`painted ${painted.distinctColours} colours`);
} finally {
    violations.push(
        ...(await page.evaluate(() => globalThis.__cspViolations ?? [])),
    );
    await browser.close();
    await host.close();
}

const report = {
    csp: cspName,
    policy: host.csp ?? null,
    elapsedMs: Date.now() - started,
    canvas,
    painted,
    cspViolations: violations,
    pageErrors,
    consoleErrors,
    failedRequests,
};

await mkdir(captures, { recursive: true });
await writeFile(
    resolve(captures, `${cspName}.json`),
    JSON.stringify(report, null, 4),
);

console.log(JSON.stringify(report, null, 4));

// "Painted" is a canvas that exists and holds more than a flat fill. A Compose
// editor is a busy screen; anything under a few hundred colours is a blank or a
// single-colour surface, not an editor.
const ok = canvas !== null && painted !== null && painted.distinctColours > 100;
console.log(ok ? "\nPAINTS: yes" : "\nPAINTS: no");
process.exitCode = ok ? 0 : 1;
