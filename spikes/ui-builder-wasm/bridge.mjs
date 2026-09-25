#!/usr/bin/env node
//
// Drives the UI Builder host bridge the way the extension's custom editor
// does, in Chromium, without VS Code.
//
// What it reproduces from a real webview, deliberately:
// - TWO ORIGINS. The page is served from one origin and the archive from
//   another, with `Access-Control-Allow-Origin: *` — the shape of a webview,
//   whose document is `vscode-webview://…` while `asWebviewUri` resources are
//   `https://file+.vscode-resource.vscode-cdn.net/…`. Anything in the editor
//   that resolves a URL against `location` instead of the archive lands on the
//   page origin, which serves nothing else, so it shows up as a 404 here
//   instead of as a mystery in a webview.
// - The extension's real HTML: `out/uiBuilderHtml.js`, compiled from
//   `src/uiBuilderHtml.ts`, CSP and nonce included (run `npm run compile:host`).
// - `acquireVsCodeApi`, stubbed to record what the editor posts.
//
// Then it plays the extension's side of the protocol: wait for `ready`, send
// `open`, and check what comes back.
//
// Usage:
//   node bridge.mjs --dist=<unpacked archive with hostBridge>=1> [--design=<file.uid>] [--seed=m3-catalog:blank]
//                   [--edit-at=x,y]   click a layer row there, delete it, undo it
//                   [--role=preview]  the Design Preview view instead of the editor
//                   [--select=<nodeId>] select a layer from the host side
//                   [--invoke=id,id]  run the editor's toolbar/rail controls the host draws
//                   [--theme=dark|light|none] [--switch-theme=light|dark]  VS Code theme colours
//
// `CHROMIUM_PATH` picks the browser. Playwright's headless shell is the one
// that paints in a software-GL container (it is what compose-preview-server's
// own harness uses in CI); a full Chromium under `--use-angle=swiftshader`
// never produced a first frame here.
import { createReadStream } from "node:fs";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { themeStyle } from "./vscode-themes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { uiBuilderWebviewHtml } = require(
    resolve(here, "../../out/uiBuilderHtml.js"),
);

function flag(name, fallback) {
    const match = process.argv.find((a) => a.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : fallback;
}

const dist = resolve(flag("dist", resolve(here, "out/bridge-dist")));
const designPath = flag("design");
const seedFlag = flag("seed", designPath ? undefined : "m3-catalog:blank");
const timeout = Number(flag("timeout", "180000"));
const editAt = flag("edit-at");
const role = flag("role", "editor");
const selectNode = flag("select");
const invokeIds = flag("invoke", "").split(",").filter(Boolean);
// A VS Code theme to give the page, as a webview gets one: `dark`, `light`, or
// `none` for no workbench colours (the editor's own). `--switch-theme` flips
// it after the first capture, to check the editor follows a live change.
const themeKind = flag("theme", "dark");
const switchTheme = flag("switch-theme");
const outDir = resolve(here, "out/bridge");
await mkdir(outDir, { recursive: true });

const manifest = JSON.parse(
    await readFile(join(dist, "ui-builder-web.json"), "utf8"),
);
console.log(
    `archive ${manifest.version}, hostBridge ${manifest.hostBridge ?? "(none)"}`,
);

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".cvr": "application/octet-stream",
};

const pageOriginMisses = [];

// The archive origin: the webview resource host.
const resources = createServer(async (request, response) => {
    const path = normalize(
        decodeURIComponent(new URL(request.url, "http://x").pathname),
    ).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, path);
    try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error();
        response.writeHead(200, {
            "content-type": TYPES[extname(file)] ?? "application/octet-stream",
            "content-length": info.size,
            "access-control-allow-origin": "*",
        });
        createReadStream(file).pipe(response);
    } catch {
        response.writeHead(404, { "access-control-allow-origin": "*" });
        response.end();
    }
});
await new Promise((r) => resources.listen(0, "127.0.0.1", r));
const resourceOrigin = `http://127.0.0.1:${resources.address().port}`;

// The page origin: the webview document, and nothing else.
const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
    "base64",
);
const webviewHtml = uiBuilderWebviewHtml({
    indexHtml: await readFile(join(dist, "index.html"), "utf8"),
    baseHref: `${resourceOrigin}/`,
    cspSource: resourceOrigin,
    nonce,
    role,
});
// A webview's <html> arrives carrying the workbench theme as `--vscode-*`
// variables on its style attribute; this is that, for the chosen theme.
const html =
    themeKind === "none"
        ? webviewHtml
        : webviewHtml.replace(
              /<html([^>]*)>/i,
              `<html$1 style="${themeStyle(themeKind)}">`,
          );
await writeFile(join(outDir, "page.html"), html);
const page = createServer((request, response) => {
    if (request.url === "/" || request.url.startsWith("/?")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
        return;
    }
    pageOriginMisses.push(request.url);
    response.writeHead(404);
    response.end();
});
await new Promise((r) => page.listen(0, "localhost", r));
const pageUrl = `http://localhost:${page.address().port}/`;

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
});
const tab = await context.newPage();
const t0 = Date.now();
const at = () => `[+${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const problems = [];
tab.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
        const text = m.text().slice(0, 400);
        console.log(`${at()} console.${m.type()}: ${text}`);
        if (m.type() === "error") problems.push(text);
    }
});
tab.on("pageerror", (e) => {
    console.log(`${at()} pageerror: ${e.message.slice(0, 400)}`);
    problems.push(e.message);
});
tab.on("requestfailed", (r) =>
    console.log(`${at()} request failed: ${r.url()} ${r.failure()?.errorText}`),
);

// The extension's side: `acquireVsCodeApi().postMessage` lands here.
const posted = [];
await tab.exposeFunction("__hostReceived", (message) => {
    posted.push(message);
    const summary = message.document
        ? `${message.document.length} chars`
        : (message.message ?? message.url ?? "");
    console.log(`${at()} editor -> host: ${message.type} ${summary}`);
});
await tab.addInitScript(() => {
    globalThis.acquireVsCodeApi = () => ({
        postMessage: (message) => globalThis.__hostReceived(message),
        getState: () => undefined,
        setState: () => undefined,
    });
});

async function waitForPosted(type, since = 0) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const found = posted.slice(since).find((m) => m.type === type);
        if (found) return found;
        const error = posted
            .slice(since)
            .find((m) => m.type === "compose-ui-builder/error");
        if (error)
            throw new Error(`editor refused the design: ${error.message}`);
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no ${type} within ${timeout} ms`);
}

let verdict = "FAIL";
try {
    await tab.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await waitForPosted("compose-ui-builder/ready");
    const theme = await tab.evaluate(() =>
        globalThis.composeUiBuilderHost?.readTheme?.(),
    );
    const parsedTheme = theme ? JSON.parse(theme) : undefined;
    console.log(
        `${at()} host theme: ${parsedTheme ? `${Object.keys(parsedTheme.roles).length} roles, ${Object.keys(parsedTheme.palette).length} palette colours` : "none"}`,
    );

    const open = { type: "compose-ui-builder/open" };
    let systemId;
    if (designPath) {
        open.document = await readFile(designPath, "utf8");
        systemId = JSON.parse(open.document).catalogPin.systemId;
    } else {
        const [catalog, templateId] = seedFlag.split(":");
        systemId = catalog;
        open.document = "";
        open.seed = {
            designId: "bridge-probe",
            templateId,
            fixture: await readFile(
                join(dist, "jetcaster-discover-operations-v1.json"),
                "utf8",
            ),
        };
    }
    open.capabilities = await readFile(
        join(dist, `${systemId}-capabilities-v1.json`),
        "utf8",
    );
    const before = posted.length;
    await tab.evaluate((message) => window.postMessage(message, "*"), open);
    console.log(
        `${at()} host -> editor: open (${designPath ? "document" : `seed ${seedFlag}`})`,
    );

    if (!designPath) {
        const changed = await waitForPosted(
            "compose-ui-builder/changed",
            before,
        );
        const document = JSON.parse(changed.document);
        console.log(
            `${at()} seeded design: schema=${document.schema} id=${document.id} catalog=${document.catalogPin.systemId} roots=${document.roots.length} nodes=${Object.keys(document.nodes).length}`,
        );
        await writeFile(join(outDir, "seeded.uid"), changed.document);
    }

    await tab.waitForFunction(
        () =>
            document.documentElement.getAttribute("data-ui-builder-ready") ===
            "true",
        null,
        { timeout },
    );
    console.log(`${at()} editor ready`);
    // Let a few frames land before the capture.
    await tab.waitForTimeout(3000);
    await tab.screenshot({ path: join(outDir, "editor.png") });
    console.log(`${at()} screenshot ${join(outDir, "editor.png")}`);

    if (switchTheme) {
        await tab.evaluate(
            (style) => document.documentElement.setAttribute("style", style),
            themeStyle(switchTheme),
        );
        await tab.waitForTimeout(2000);
        await tab.screenshot({
            path: join(outDir, `theme-${switchTheme}.png`),
        });
        console.log(
            `${at()} switched to the ${switchTheme} theme; screenshot theme-${switchTheme}.png`,
        );
    }

    const chrome = posted
        .filter((m) => m.type === "compose-ui-builder/chrome")
        .at(-1);
    if (chrome) {
        console.log(`${at()} chrome the host draws:`);
        for (const a of chrome.actions) {
            console.log(
                `    ${a.group.padEnd(9)} ${a.id.padEnd(22)} ${a.label}${a.enabled ? "" : " (disabled)"}${a.checked === null ? "" : a.checked ? " [on]" : " [off]"}${a.badge ? ` (${a.badge})` : ""}`,
            );
        }
    }
    for (const id of invokeIds) {
        const mark = posted.length;
        await tab.evaluate(
            (id) =>
                window.postMessage(
                    { type: "compose-ui-builder/invoke", id },
                    "*",
                ),
            id,
        );
        await tab.waitForTimeout(1500);
        const after = posted
            .slice(mark)
            .filter((m) => m.type === "compose-ui-builder/chrome")
            .at(-1);
        const error = posted
            .slice(mark)
            .find((m) => m.type === "compose-ui-builder/error");
        if (error) throw new Error(`invoke ${id}: ${error.message}`);
        const state = after?.actions.find((a) => a.id === id);
        console.log(
            `${at()} invoked ${id}${state && state.checked !== null ? ` -> ${state.checked ? "on" : "off"}` : ""}`,
        );
        await tab.screenshot({ path: join(outDir, `invoke-${id}.png`) });
    }

    if (selectNode) {
        // The host's layer tree selecting a node: the editor must select it and say so.
        const mark = posted.length;
        await tab.evaluate(
            (nodeId) =>
                window.postMessage(
                    { type: "compose-ui-builder/select", nodeId },
                    "*",
                ),
            selectNode,
        );
        const selection = await waitForPosted(
            "compose-ui-builder/selection",
            mark,
        );
        console.log(
            `${at()} host select ${selectNode} -> editor selection ${selection.nodeId}`,
        );
        if (selection.nodeId !== selectNode)
            throw new Error(`selected ${selection.nodeId}, not ${selectNode}`);
        await tab.waitForTimeout(1000);
        await tab.screenshot({ path: join(outDir, "selected.png") });
    }

    if (editAt) {
        // An edit made the way a person makes it — select a layer, press
        // Backspace — must reach the host as `changed`, and so must its undo.
        const [x, y] = editAt.split(",").map(Number);
        await tab.mouse.click(x, y);
        await tab.waitForTimeout(500);
        const selected = await tab.evaluate(
            () => globalThis.__uiBuilderEditor?.selectedNodeId,
        );
        console.log(`${at()} selected ${selected}`);
        const nodesIn = (message) =>
            Object.keys(JSON.parse(message.document).nodes).length;
        let mark = posted.length;
        await tab.keyboard.press("Backspace");
        await tab.waitForTimeout(1000);
        console.log(
            `${at()} editor state after Backspace: ${JSON.stringify(await tab.evaluate(() => globalThis.__uiBuilderEditor))}`,
        );
        const deleted = await waitForPosted("compose-ui-builder/changed", mark);
        console.log(
            `${at()} after delete: ${nodesIn(deleted)} nodes, revision ${JSON.parse(deleted.document).revision}`,
        );
        mark = posted.length;
        await tab.keyboard.press("Control+z");
        const undone = await waitForPosted("compose-ui-builder/changed", mark);
        console.log(
            `${at()} after undo: ${nodesIn(undone)} nodes, revision ${JSON.parse(undone.document).revision}`,
        );
        await writeFile(join(outDir, "after-undo.uid"), undone.document);
    }
    verdict =
        problems.length === 0 && pageOriginMisses.length === 0
            ? "PASS"
            : "PASS WITH PROBLEMS";
} catch (error) {
    console.log(`${at()} ${error.message}`);
    await tab.screenshot({ path: join(outDir, "failure.png") }).catch(() => {});
}
console.log(
    `page-origin requests (should be none): ${pageOriginMisses.length ? pageOriginMisses.join(", ") : "none"}`,
);
console.log(`BRIDGE: ${verdict}`);
await writeFile(
    join(outDir, "posted.json"),
    JSON.stringify(
        posted.map((m) => ({
            ...m,
            document: m.document ? `${m.document.length} chars` : undefined,
        })),
        null,
        2,
    ),
);
await browser.close();
resources.close();
page.close();
process.exit(verdict === "FAIL" ? 1 : 0);
