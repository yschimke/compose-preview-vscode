#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "..");
const defaultAllowlist = resolve(here, "daemon-launch-schema-allowlist.json");
const prunedDirectories = new Set([
    ".git",
    "build",
    "dist",
    "node_modules",
    "out",
]);
const versionDeclaration =
    /(?:export\s+)?const\s+(\w*(?:DESCRIPTOR|DAEMON_LAUNCH)_SCHEMA_VERSION)\b(?:\s*:\s*number)?\s*=\s*(\d+)\b/g;

function maskCommentsAndStrings(source) {
    const chars = [...source];
    let mode = "code";
    let quote = "";

    for (let i = 0; i < chars.length; i += 1) {
        const current = chars[i];
        const next = chars[i + 1];

        if (mode === "line-comment") {
            if (current === "\n") {
                mode = "code";
            } else {
                chars[i] = " ";
            }
            continue;
        }
        if (mode === "block-comment") {
            chars[i] = current === "\n" ? "\n" : " ";
            if (current === "*" && next === "/") {
                chars[i + 1] = " ";
                i += 1;
                mode = "code";
            }
            continue;
        }
        if (mode === "string") {
            chars[i] = current === "\n" ? "\n" : " ";
            if (current === "\\") {
                if (i + 1 < chars.length) {
                    chars[i + 1] = chars[i + 1] === "\n" ? "\n" : " ";
                    i += 1;
                }
            } else if (current === quote) {
                mode = "code";
            }
            continue;
        }

        if (current === "/" && next === "/") {
            chars[i] = " ";
            chars[i + 1] = " ";
            i += 1;
            mode = "line-comment";
        } else if (current === "/" && next === "*") {
            chars[i] = " ";
            chars[i + 1] = " ";
            i += 1;
            mode = "block-comment";
        } else if (current === '"' || current === "'" || current === "`") {
            chars[i] = " ";
            quote = current;
            mode = "string";
        }
    }

    return chars.join("");
}

export function declarationsIn(source) {
    return [...maskCommentsAndStrings(source).matchAll(versionDeclaration)].map(
        (match) => ({ symbol: match[1], version: Number(match[2]) }),
    );
}

async function typescriptFiles(root) {
    const found = [];

    async function walk(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (
                entry.name.startsWith(".") ||
                prunedDirectories.has(entry.name)
            ) {
                continue;
            }
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(path);
            } else if (entry.isFile() && entry.name.endsWith(".ts")) {
                found.push(path);
            }
        }
    }

    await walk(root);
    return found.sort();
}

function relativePath(root, path) {
    return relative(root, path).split(sep).join("/");
}

export async function discoverVersionSites(repoRoot) {
    const sites = [];
    for (const path of await typescriptFiles(repoRoot)) {
        const source = await readFile(path, "utf8");
        for (const declaration of declarationsIn(source)) {
            sites.push({ file: relativePath(repoRoot, path), ...declaration });
        }
    }
    return sites;
}

function metadataUrl(version) {
    const base =
        "https://repo1.maven.org/maven2/ee/schimke/composeai/daemon-launch-builder";
    return `${base}/${version}/daemon-launch-builder-${version}-schema.json`;
}

async function fetchMetadata(version) {
    const url = metadataUrl(version);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
        throw new Error(
            `could not resolve daemon-launch schema metadata for pinned plugin ${version}: ${response.status} ${response.statusText} (${url})`,
        );
    }
    return { metadata: await response.json(), source: url };
}

export async function checkDaemonLaunchSchema({
    repoRoot = defaultRepoRoot,
    allowlistPath = defaultAllowlist,
    metadata,
    metadataSource = "provided metadata",
} = {}) {
    const pin = JSON.parse(
        await readFile(resolve(repoRoot, "plugin-version.json"), "utf8"),
    );
    const pinnedVersion = pin.composeAiPlugin;
    if (typeof pinnedVersion !== "string" || pinnedVersion.length === 0) {
        throw new Error(
            "plugin-version.json has no non-empty composeAiPlugin pin",
        );
    }

    let resolvedMetadata = metadata;
    let resolvedSource = metadataSource;
    if (resolvedMetadata === undefined) {
        const fetched = await fetchMetadata(pinnedVersion);
        resolvedMetadata = fetched.metadata;
        resolvedSource = fetched.source;
    }
    if (resolvedMetadata.schema !== "compose-preview-daemon-launch") {
        throw new Error(
            `${resolvedSource} is not compose-preview daemon-launch schema metadata`,
        );
    }
    if (!Number.isInteger(resolvedMetadata.schemaVersion)) {
        throw new Error(`${resolvedSource} has no integer schemaVersion`);
    }

    const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
    const registered = new Map(
        allowlist.schemaVersionSites.map((site) => [
            `${site.file}:${site.symbol}`,
            site,
        ]),
    );
    const discovered = await discoverVersionSites(repoRoot);
    const seen = new Set();

    for (const site of discovered) {
        const key = `${site.file}:${site.symbol}`;
        if (!registered.has(key)) {
            throw new Error(
                `${key} is an unregistered daemon-launch schema-version mirror; register it in ${relativePath(repoRoot, allowlistPath)} or remove the copy`,
            );
        }
        seen.add(key);
        if (site.version !== resolvedMetadata.schemaVersion) {
            throw new Error(
                `${key} is schema v${site.version}, but plugin ${pinnedVersion} publishes v${resolvedMetadata.schemaVersion}`,
            );
        }
    }

    for (const key of registered.keys()) {
        if (!seen.has(key)) {
            throw new Error(
                `${key} is registered but no longer declares an integer schema-version constant; prune the stale entry`,
            );
        }
    }

    return {
        pinnedVersion,
        schemaVersion: resolvedMetadata.schemaVersion,
        siteCount: discovered.length,
        metadataSource: resolvedSource,
    };
}

async function main() {
    try {
        const result = await checkDaemonLaunchSchema();
        console.log(
            `daemon-launch schema: plugin ${result.pinnedVersion} publishes v${result.schemaVersion}; ${result.siteCount} registered TypeScript site(s) agree`,
        );
    } catch (error) {
        console.error(`daemon-launch schema: FAILED — ${error.message}`);
        process.exitCode = 1;
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    await main();
}
