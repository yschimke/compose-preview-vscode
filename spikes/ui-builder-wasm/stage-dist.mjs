#!/usr/bin/env node
//
// Stages the editor's Wasm distribution into `out/dist` from a
// yschimke/compose-ui-builder CHECKOUT, by running that repository's own
// `:ui-builder-web:webArchive` task and unpacking what it produces.
//
// Deliberately not a download. The editor archive is not consumed from a Maven
// release: the plan is a combined build against a checkout first, and only later
// — if ever — a published asset. So this script takes the same shape as the two
// generators AGENTS.md already documents (`a11y-wear.gen.mjs`,
// `spatial-xr-real.gen.mjs`): it needs a sibling checkout, it runs only when
// someone is regenerating, and nothing in CI depends on it.
//
// Usage:
//   UI_BUILDER_CHECKOUT=../../../compose-ui-builder node stage-dist.mjs
//   node stage-dist.mjs --archive=/path/to/compose-preview-ui-builder-web-X.Y.Z.zip
//
// The second form exists for a checkout that has already built the archive, so a
// re-run of the spike does not re-run a Wasm build.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "out/dist");

function flag(name) {
    const match = process.argv.find((argument) =>
        argument.startsWith(`--${name}=`),
    );
    return match ? match.slice(name.length + 3) : undefined;
}

async function newestArchive(directory) {
    if (!existsSync(directory)) return undefined;
    const candidates = [];
    for (const name of await readdir(directory)) {
        if (/^compose-preview-ui-builder-web-.*\.zip$/.test(name)) {
            const path = join(directory, name);
            candidates.push({ path, mtime: (await stat(path)).mtimeMs });
        }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path;
}

let archive = flag("archive");

if (!archive) {
    const checkout = resolve(
        process.env.UI_BUILDER_CHECKOUT ?? resolve(here, "../../../compose-ui-builder"),
    );
    if (!existsSync(join(checkout, "settings.gradle.kts"))) {
        throw new Error(
            `no compose-ui-builder checkout at ${checkout}. Clone yschimke/compose-ui-builder and point UI_BUILDER_CHECKOUT at it, or pass --archive=<zip>.`,
        );
    }
    console.log(`[stage-dist] building :ui-builder-web:webArchive in ${checkout}`);
    // build-brief when it is on PATH: a Wasm/Compose build buries its one real
    // line in thousands, and this is a long build to read the tail of.
    const brief = spawnSync("build-brief", ["--version"], { stdio: "ignore" });
    const command = brief.status === 0 ? "build-brief" : "./gradlew";
    const args =
        brief.status === 0
            ? ["./gradlew", ":ui-builder-web:webArchive"]
            : [":ui-builder-web:webArchive"];
    const build = spawnSync(command, args, { cwd: checkout, stdio: "inherit" });
    if (build.status !== 0) {
        throw new Error(
            `:ui-builder-web:webArchive failed (exit ${build.status}); the spike needs that archive`,
        );
    }
    archive = await newestArchive(join(checkout, "ui-builder-web/build/distributions"));
    if (!archive) {
        throw new Error(
            "the build reported success but produced no compose-preview-ui-builder-web-*.zip",
        );
    }
}

console.log(`[stage-dist] unpacking ${archive}`);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const unzip = spawnSync("unzip", ["-q", archive, "-d", dist], {
    stdio: "inherit",
});
if (unzip.status !== 0) {
    throw new Error(`unzip failed (exit ${unzip.status})`);
}
if (!existsSync(join(dist, "index.html"))) {
    throw new Error(`${archive} has no index.html at its root`);
}
console.log(`[stage-dist] staged ${dist}`);
