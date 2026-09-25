// Finds the compose-ui-builder web editor the UI Builder custom editor runs.
//
// Two sources, in order:
//
// 1. `composePreview.uiBuilder.webDistPath` — an unpacked archive directory, or
//    the `compose-preview-ui-builder-web-*.zip` a compose-ui-builder checkout's
//    `:ui-builder-web:webArchive` writes. This is the combined-build loop: edit
//    the editor there, rebuild, reopen the design here.
// 2. The release pinned in uiBuilderPin.ts, downloaded once into global
//    storage and verified against its sha256 before a byte of it is unpacked.
//
// Not bundled in the VSIX: the archive is ~20 MB zipped and ~90 MB unpacked,
// and every user would pay for a feature behind the early-features switch.
//
// Either way the archive must declare a host-bridge version this extension
// speaks (`hostBridge` in its `ui-builder-web.json`); an editor without the
// bridge would load and then never answer, which is the one failure worth
// refusing up front.

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { readZip } from "./uiBuilderZip";
import {
    UI_BUILDER_WEB_PIN,
    uiBuilderWebArchiveUrl,
    type UiBuilderWebPin,
} from "./uiBuilderPin";

/** The host-bridge versions this extension's custom editor speaks. */
export const SUPPORTED_HOST_BRIDGE: readonly number[] = [1];

export interface UiBuilderWebManifest {
    schema: string;
    version: string;
    serverApi?: number;
    hostBridge?: number;
}

export interface UiBuilderDist {
    /** Directory holding `index.html` and the rest of the unpacked archive. */
    root: string;
    manifest: UiBuilderWebManifest;
    /** Where it came from, for the output channel and error messages. */
    source: string;
}

export interface ResolveDistOptions {
    /** `composePreview.uiBuilder.webDistPath`, empty when unset. */
    configuredPath: string;
    /** A directory this extension owns (global storage). */
    storageRoot: string;
    pin?: UiBuilderWebPin;
    download: (url: string) => Promise<Buffer>;
    log: (message: string) => void;
}

export class UiBuilderDistError extends Error {}

export async function resolveUiBuilderDist(
    options: ResolveDistOptions,
): Promise<UiBuilderDist> {
    const configured = options.configuredPath.trim();
    const dist = configured
        ? await fromConfiguredPath(configured, options)
        : await fromPinnedRelease(options.pin ?? UI_BUILDER_WEB_PIN, options);
    checkHostBridge(dist);
    return dist;
}

export function checkHostBridge(dist: UiBuilderDist): void {
    const bridge = dist.manifest.hostBridge;
    if (bridge === undefined) {
        throw new UiBuilderDistError(
            `The UI Builder editor ${dist.manifest.version} (${dist.source}) predates the host bridge VS Code needs. ` +
                "Point composePreview.uiBuilder.webDistPath at a newer build — a compose-ui-builder checkout's " +
                "ui-builder-web/build/distributions/*.zip — or update the extension.",
        );
    }
    if (!SUPPORTED_HOST_BRIDGE.includes(bridge)) {
        throw new UiBuilderDistError(
            `The UI Builder editor ${dist.manifest.version} speaks host bridge ${bridge}; ` +
                `this extension speaks ${SUPPORTED_HOST_BRIDGE.join(", ")}.`,
        );
    }
}

export async function readManifest(
    root: string,
): Promise<UiBuilderWebManifest> {
    let text: string;
    try {
        text = await fs.readFile(
            path.join(root, "ui-builder-web.json"),
            "utf8",
        );
    } catch {
        throw new UiBuilderDistError(
            `${root} is not a UI Builder web archive: it has no ui-builder-web.json`,
        );
    }
    const manifest = JSON.parse(text) as UiBuilderWebManifest;
    if (manifest.schema !== "compose-ui-builder-web/v1") {
        throw new UiBuilderDistError(
            `${root}/ui-builder-web.json declares schema ${manifest.schema}, not compose-ui-builder-web/v1`,
        );
    }
    return manifest;
}

async function fromConfiguredPath(
    configured: string,
    options: ResolveDistOptions,
): Promise<UiBuilderDist> {
    const stat = await fs.stat(configured).catch(() => undefined);
    if (!stat) {
        throw new UiBuilderDistError(
            `composePreview.uiBuilder.webDistPath points at ${configured}, which does not exist`,
        );
    }
    if (stat.isDirectory()) {
        return {
            root: configured,
            manifest: await readManifest(configured),
            source: configured,
        };
    }
    // A zip: unpacked under a key of its bytes, so a rebuilt archive at the
    // same path is a new directory rather than a stale one.
    const bytes = await fs.readFile(configured);
    const digest = sha256(bytes);
    const root = await unpackOnce(
        bytes,
        path.join(options.storageRoot, "local", digest.slice(0, 16)),
    );
    options.log(`[ui-builder] using ${configured} (unpacked to ${root})`);
    return { root, manifest: await readManifest(root), source: configured };
}

async function fromPinnedRelease(
    pin: UiBuilderWebPin,
    options: ResolveDistOptions,
): Promise<UiBuilderDist> {
    const root = path.join(options.storageRoot, "release", pin.version);
    if (!(await isComplete(root))) {
        const url = uiBuilderWebArchiveUrl(pin.version);
        options.log(`[ui-builder] downloading ${url}`);
        const bytes = await options.download(url);
        const digest = sha256(bytes);
        if (digest !== pin.sha256) {
            throw new UiBuilderDistError(
                `${url} has sha256 ${digest}, but the extension pins ${pin.sha256}. Refusing to run it.`,
            );
        }
        await unpackOnce(bytes, root);
    }
    return {
        root,
        manifest: await readManifest(root),
        source: `release ${pin.version}`,
    };
}

/**
 * Unpacks [bytes] into [root] unless a previous run finished doing so.
 * Written to a sibling and renamed, so a crash mid-way never leaves a
 * half-unpacked directory that looks complete.
 */
async function unpackOnce(bytes: Buffer, root: string): Promise<string> {
    if (await isComplete(root)) return root;
    const staging = `${root}.tmp-${process.pid}-${Date.now()}`;
    await fs.rm(staging, { recursive: true, force: true });
    for (const entry of readZip(bytes)) {
        const target = path.join(staging, entry.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.data);
    }
    await fs.writeFile(path.join(staging, COMPLETE_MARKER), "");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(path.dirname(root), { recursive: true });
    await fs.rename(staging, root);
    return root;
}

const COMPLETE_MARKER = ".compose-preview-complete";

async function isComplete(root: string): Promise<boolean> {
    return fs
        .stat(path.join(root, COMPLETE_MARKER))
        .then(() => true)
        .catch(() => false);
}

function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** GET [url] into memory, following redirects (GitHub release assets redirect). */
export async function downloadBytes(url: string): Promise<Buffer> {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
        throw new UiBuilderDistError(
            `Downloading ${url} failed: HTTP ${response.status}`,
        );
    }
    return Buffer.from(await response.arrayBuffer());
}
