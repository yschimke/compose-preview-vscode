import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    checkDaemonLaunchSchema,
    declarationsIn,
} from "./check-daemon-launch-schema.mjs";

const temporaryRoots = [];
const metadata = {
    schema: "compose-preview-daemon-launch",
    schemaVersion: 2,
};

afterEach(async () => {
    await Promise.all(
        temporaryRoots
            .splice(0)
            .map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function fixture({ source, registered = true }) {
    const root = await mkdtemp(join(tmpdir(), "daemon-launch-schema-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "src", "daemon"), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
        join(root, "plugin-version.json"),
        JSON.stringify({ composeAiPlugin: "1.61.2" }),
    );
    await writeFile(join(root, "src", "daemon", "daemonProtocol.ts"), source);
    const sites = registered
        ? [
              {
                  file: "src/daemon/daemonProtocol.ts",
                  symbol: "DAEMON_DESCRIPTOR_SCHEMA_VERSION",
                  why: "test",
              },
          ]
        : [];
    const allowlistPath = join(
        root,
        "scripts",
        "daemon-launch-schema-allowlist.json",
    );
    await writeFile(
        allowlistPath,
        JSON.stringify({ schemaVersionSites: sites }),
    );
    return { root, allowlistPath };
}

describe("daemon-launch schema gate", () => {
    it("uses the module version from a partial release BOM", async (t) => {
        const { root, allowlistPath } = await fixture({
            source: "export const DAEMON_DESCRIPTOR_SCHEMA_VERSION = 2;",
        });
        const urls = [];
        t.mock.method(globalThis, "fetch", async (url) => {
            urls.push(url);
            if (url.endsWith("compose-ai-tools-bom-1.61.2.pom")) {
                return new Response(`
                    <project><dependencyManagement><dependencies><dependency>
                    <groupId>ee.schimke.composeai</groupId>
                    <artifactId>daemon-launch-builder</artifactId>
                    <version>1.60.0</version>
                    </dependency></dependencies></dependencyManagement></project>
                `);
            }
            if (url.endsWith("daemon-launch-builder-1.60.0-schema.json")) {
                return Response.json(metadata);
            }
            throw new Error(`Unexpected artifact lookup: ${url}`);
        });
        const result = await checkDaemonLaunchSchema({
            repoRoot: root,
            allowlistPath,
        });
        assert.equal(result.schemaVersion, 2);
        assert.equal(urls.length, 2);
        assert.match(result.metadataSource, /\/1\.60\.0\//);
    });

    it("ignores declarations written only in comments and strings", () => {
        const declarations = declarationsIn(`
            // export const COMMENT_DESCRIPTOR_SCHEMA_VERSION = 1;
            const text = "export const STRING_DESCRIPTOR_SCHEMA_VERSION = 1";
            export const DAEMON_DESCRIPTOR_SCHEMA_VERSION: number = 2;
        `);
        assert.deepEqual(declarations, [
            { symbol: "DAEMON_DESCRIPTOR_SCHEMA_VERSION", version: 2 },
        ]);
    });

    it("accepts the registered reader at the pinned artifact version", async () => {
        const { root, allowlistPath } = await fixture({
            source: "export const DAEMON_DESCRIPTOR_SCHEMA_VERSION = 2;",
        });
        const result = await checkDaemonLaunchSchema({
            repoRoot: root,
            allowlistPath,
            metadata,
        });
        assert.equal(result.pinnedVersion, "1.61.2");
        assert.equal(result.schemaVersion, 2);
        assert.equal(result.siteCount, 1);
    });

    it("rejects a reader version that differs from the pinned artifact", async () => {
        const { root, allowlistPath } = await fixture({
            source: "export const DAEMON_DESCRIPTOR_SCHEMA_VERSION = 3;",
        });
        await assert.rejects(
            checkDaemonLaunchSchema({
                repoRoot: root,
                allowlistPath,
                metadata,
            }),
            /schema v3, but plugin 1\.61\.2 publishes v2/,
        );
    });

    it("rejects an unregistered mirror anywhere in the TypeScript tree", async () => {
        const { root, allowlistPath } = await fixture({
            source: "export const DAEMON_DESCRIPTOR_SCHEMA_VERSION = 2;",
            registered: false,
        });
        await assert.rejects(
            checkDaemonLaunchSchema({
                repoRoot: root,
                allowlistPath,
                metadata,
            }),
            /unregistered daemon-launch schema-version mirror/,
        );
    });

    it("rejects a stale allowlist entry", async () => {
        const { root, allowlistPath } = await fixture({ source: "export {};" });
        await assert.rejects(
            checkDaemonLaunchSchema({
                repoRoot: root,
                allowlistPath,
                metadata,
            }),
            /registered but no longer declares/,
        );
    });
});
