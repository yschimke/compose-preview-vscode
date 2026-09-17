import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    checkDaemonPin,
    daemonBomVersionIn,
    pomUrl,
} from "./check-daemon-pin.mjs";

const temporaryRoots = [];

function pom(dependencies) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <groupId>ee.schimke.composeai</groupId>
  <artifactId>render-host</artifactId>
  <dependencyManagement>
    <dependencies>${dependencies}</dependencies>
  </dependencyManagement>
</project>`;
}

function bomImport(version) {
    return `
      <dependency>
        <groupId>ee.schimke.composeai</groupId>
        <artifactId>compose-preview-daemon-bom</artifactId>
        <version>${version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>`;
}

afterEach(async () => {
    await Promise.all(
        temporaryRoots
            .splice(0)
            .map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function fixture(pin) {
    const root = await mkdtemp(join(tmpdir(), "daemon-pin-"));
    temporaryRoots.push(root);
    await writeFile(
        join(root, "plugin-version.json"),
        JSON.stringify({
            composeAiPlugin: "2.18.1",
            composePreviewDaemon: "3.8.0",
            ...pin,
        }),
    );
    return root;
}

describe("daemon pin gate", () => {
    it("reads the imported daemon BOM version out of a POM", () => {
        assert.equal(daemonBomVersionIn(pom(bomImport("3.8.0"))), "3.8.0");
    });

    it("reports no version when the POM imports no daemon BOM", () => {
        assert.equal(daemonBomVersionIn(pom("")), undefined);
    });

    it("does not mistake a neighbouring dependency's version for the BOM's", () => {
        const neighbour = `
      <dependency>
        <groupId>ee.schimke.composeai</groupId>
        <artifactId>compose-preview-contracts-bom</artifactId>
        <version>3.0.0</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>`;
        assert.equal(
            daemonBomVersionIn(pom(neighbour + bomImport("3.8.0"))),
            "3.8.0",
        );
    });

    it("rejects a POM importing the BOM twice at different versions", () => {
        assert.throws(
            () =>
                daemonBomVersionIn(
                    pom(bomImport("3.8.0") + bomImport("3.7.0")),
                ),
            /more than one version \(3\.7\.0, 3\.8\.0\)/,
        );
    });

    it("accepts a pin matching the published import", async () => {
        const result = await checkDaemonPin({
            repoRoot: await fixture({}),
            pom: pom(bomImport("3.8.0")),
        });
        assert.equal(result.pluginVersion, "2.18.1");
        assert.equal(result.daemonVersion, "3.8.0");
    });

    it("rejects a daemon pin that has skewed from the plugin's", async () => {
        await assert.rejects(
            checkDaemonPin({
                repoRoot: await fixture({ composePreviewDaemon: "3.6.1" }),
                pom: pom(bomImport("3.8.0")),
            }),
            /pins composePreviewDaemon 3\.6\.1, but plugin 2\.18\.1 resolves the daemon at 3\.8\.0/,
        );
    });

    it("rejects a missing daemon pin rather than defaulting one", async () => {
        await assert.rejects(
            checkDaemonPin({
                repoRoot: await fixture({ composePreviewDaemon: "" }),
                pom: pom(bomImport("3.8.0")),
            }),
            /no non-empty composePreviewDaemon pin/,
        );
    });

    it("fails loudly when the anchor POM stops importing the BOM", async () => {
        await assert.rejects(
            checkDaemonPin({
                repoRoot: await fixture({}),
                pom: pom(""),
            }),
            /imports no compose-preview-daemon-bom/,
        );
    });

    it("resolves the anchor POM at the pinned plugin version", () => {
        assert.equal(
            pomUrl("2.18.1"),
            "https://repo1.maven.org/maven2/ee/schimke/composeai/render-host/2.18.1/render-host-2.18.1.pom",
        );
    });
});
