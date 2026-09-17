// Serves the unpacked editor archive the way a VS Code webview would present it:
// one HTML document carrying a `<meta http-equiv="Content-Security-Policy">`, a
// per-load nonce on every script, and a `<base href>` so the archive's relative
// URLs resolve against the dist root.
//
// The CSP is the whole point of the spike, so it is a parameter rather than a
// constant, and the baseline is the extension's real one from previewPanel.ts.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".css": "text/css; charset=utf-8",
};

/**
 * The CSP the five existing panels use, verbatim in shape: everything denied,
 * scripts only by nonce. `${webview.cspSource}` is a single origin at runtime,
 * and in this harness the dist is served from the page's own origin, so 'self'
 * stands in for it.
 */
export function extensionBaselineCsp(nonce) {
    return [
        "default-src 'none'",
        "img-src data: 'self'",
        "font-src 'self'",
        `style-src 'self' 'nonce-${nonce}'`,
        `script-src 'nonce-${nonce}'`,
    ].join("; ");
}

/**
 * The baseline plus exactly what the handover note predicted the Wasm editor
 * needs: 'wasm-unsafe-eval', a connect-src for the two .wasm fetches, a
 * worker-src for Skiko, and a frame-src for the sandboxed renderer iframe.
 */
export function notePredictedCsp(nonce) {
    return [
        "default-src 'none'",
        "img-src data: blob: 'self'",
        "font-src 'self'",
        `style-src 'self' 'unsafe-inline'`,
        `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
        "connect-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "frame-src 'self'",
    ].join("; ");
}

export const CSPS = {
    baseline: extensionBaselineCsp,
    predicted: notePredictedCsp,
    // Control: no CSP at all. If the editor does not paint here either, the
    // failure is the archive or the runtime, not the policy — which is the
    // first thing to rule out before blaming a directive.
    none: () => undefined,
};

function nonceFor() {
    return Buffer.from(
        Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
    ).toString("base64");
}

/**
 * Rewrites the archive's index.html into webview-shaped HTML. Every script tag
 * gets the nonce — including the inline `<script type="importmap">`, which a
 * nonce-only `script-src` blocks like any other inline script, and whose failure
 * mode is a bare-specifier module error rather than a CSP report naming it.
 */
export function webviewHtml(source, { csp, nonce, baseHref }) {
    let html = source;
    html = html.replace(
        /<head>/i,
        `<head>\n    <base href="${baseHref}">` +
            (csp
                ? `\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
                : ""),
    );
    html = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
    return html;
}

export async function startHost({ root, cspName = "predicted", port = 0 }) {
    const nonce = nonceFor();
    const csp = CSPS[cspName](nonce);
    const violations = [];

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        const path = normalize(decodeURIComponent(url.pathname)).replace(
            /^(\.\.[/\\])+/,
            "",
        );

        if (path === "/" || path === "/index.html") {
            const source = await readFile(join(root, "index.html"), "utf8");
            const body = webviewHtml(source, {
                csp,
                nonce,
                baseHref: "/",
            });
            response.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            });
            response.end(body);
            return;
        }

        const file = join(root, path);
        try {
            const info = await stat(file);
            if (!info.isFile()) throw new Error("not a file");
            response.writeHead(200, {
                "content-type": TYPES[extname(file)] ?? "application/octet-stream",
                "content-length": info.size,
                "cache-control": "no-store",
            });
            createReadStream(file).pipe(response);
        } catch {
            response.writeHead(404, { "content-type": "text/plain" });
            response.end(`not found: ${path}`);
        }
    });

    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        csp,
        nonce,
        violations,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
