import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
    requestCatalogs,
    templatesUrl,
    UiBuilderCatalogs,
    UiBuilderTemplates,
} from "../uiBuilderCatalogs";

const catalog = (systemId: string, catalogRevision = "revision-1") => ({
    schema: "compose-ui-builder-capabilities/v1-candidate",
    benchmark: {
        catalogSystemId: systemId,
        catalogRevision,
        nativeRuntimeId: "runtime-1",
    },
    components: [],
});

const wearPin = {
    systemId: "wear-m3",
    catalogRevision: "revision-1",
    capabilityDigest: "candidate",
    nativeRuntimeId: "runtime-1",
};

describe("UI Builder published catalogs", () => {
    let root: string;
    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "ui-builder-catalogs-"));
    });
    afterEach(async () => fs.rm(root, { recursive: true, force: true }));

    it("uses the server's listCatalogs protocol envelope", async () => {
        let sent: unknown;
        const result = await requestCatalogs(
            "https://example.test/api/ui-builder/v1/requests",
            async (_url, options) => {
                sent = JSON.parse(String(options?.body));
                return {
                    ok: true,
                    json: async () => ({
                        requestId: (sent as { requestId: string }).requestId,
                        response: {
                            type: "catalogs",
                            catalogs: [catalog("wear-m3")],
                        },
                    }),
                } as Response;
            },
        );
        assert.deepStrictEqual((sent as { request: unknown }).request, {
            type: "listCatalogs",
        });
        assert.strictEqual(
            (sent as { actorId: string }).actorId,
            "anonymous:visitor",
        );
        assert.strictEqual(
            (result as { catalogs: unknown[] }).catalogs.length,
            1,
        );
    });

    it("uses the served catalog and reopens it offline", async () => {
        const online = new UiBuilderCatalogs(
            root,
            "https://example.test/catalogs",
            async () => ({
                catalogs: [catalog("wear-m3"), catalog("remote-m3")],
            }),
        );
        const first = await online.load(wearPin);
        assert.strictEqual(
            JSON.parse(first).benchmark.catalogSystemId,
            "wear-m3",
        );
        const offline = new UiBuilderCatalogs(
            root,
            "https://example.test/catalogs",
            async () => {
                throw new Error("offline");
            },
        );
        assert.strictEqual(await offline.load(wearPin), first);
        await assert.rejects(
            offline.load({ systemId: "remote-m3" }),
            /not been cached/,
        );
    });

    it("keeps a cached pin when a server stops listing the catalog", async () => {
        const first = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("wear-m3")],
        }));
        const saved = await first.load(wearPin);
        const missing = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("remote-m3")],
        }));
        assert.strictEqual(await missing.load(wearPin), saved);
        const [source] = await fs.readdir(root);
        assert.strictEqual(
            await fs.readFile(
                path.join(root, source, "wear-m3-latest.json"),
                "utf8",
            ),
            saved,
        );
        await assert.rejects(
            missing.load({ ...wearPin, catalogRevision: "unknown" }),
            /does not serve/,
        );
        await assert.rejects(
            missing.load({ systemId: "../wear-m3" }),
            /invalid catalog id/,
        );
    });

    it("keeps caches from different catalog servers separate", async () => {
        await new UiBuilderCatalogs(
            root,
            "https://one.test/requests",
            async () => ({
                catalogs: [catalog("wear-m3")],
            }),
        ).load(wearPin);
        const another = new UiBuilderCatalogs(
            root,
            "https://two.test/requests",
            async () => {
                throw new Error("offline");
            },
        );
        await assert.rejects(another.load(wearPin), /not been cached/);
    });

    it("keeps an older pinned version when the server publishes a new one", async () => {
        const old = await new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("wear-m3")],
        })).load(wearPin);
        const newer = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("wear-m3", "revision-2")],
        }));
        assert.strictEqual(await newer.load(wearPin), old);
        const latest = await newer.load({ systemId: "wear-m3" });
        assert.strictEqual(
            JSON.parse(latest).benchmark.catalogRevision,
            "revision-2",
        );
        await assert.rejects(
            newer.load({ ...wearPin, capabilityDigest: "other" }),
            /not cached/,
        );
    });

    it("selects the matching pin when a server lists multiple revisions", async () => {
        const listed = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("wear-m3", "revision-2"), catalog("wear-m3")],
        }));
        assert.strictEqual(
            JSON.parse(await listed.load(wearPin)).benchmark.catalogRevision,
            "revision-1",
        );
    });

    describe("published templates", () => {
        const capabilities = JSON.stringify(catalog("wear-m3"));
        const published = (catalogRevision = "revision-1") =>
            JSON.stringify({
                schemaVersion: 1,
                catalogPin: { ...wearPin, catalogRevision },
                templates: { "wear-list": { id: "wear-list" } },
            });

        it("names the catalog's templates route on the catalogs server", () => {
            assert.strictEqual(
                templatesUrl(
                    "https://ui.coo.ee/api/ui-builder/v1/requests",
                    "wear-m3",
                ),
                "https://ui.coo.ee/api/ui-builder/v1/catalogs/wear-m3/templates",
            );
        });

        it("sends the published set and reopens it offline", async () => {
            let asked = "";
            const online = new UiBuilderTemplates(
                root,
                "https://example.test/api/ui-builder/v1/requests",
                async (url) => {
                    asked = url;
                    return published();
                },
            );
            assert.strictEqual(
                await online.forTemplate(capabilities, "wear-list"),
                published(),
            );
            assert.strictEqual(
                asked,
                "https://example.test/api/ui-builder/v1/catalogs/wear-m3/templates",
            );
            const offline = new UiBuilderTemplates(
                root,
                "https://example.test/api/ui-builder/v1/requests",
                async () => {
                    throw new Error("offline");
                },
            );
            assert.strictEqual(
                await offline.forTemplate(capabilities, "wear-list"),
                published(),
            );
        });

        it("sends nothing for a template the catalog does not publish", async () => {
            const templates = new UiBuilderTemplates(
                root,
                "https://example.test/catalogs",
                async () => published(),
            );
            assert.strictEqual(
                await templates.forTemplate(capabilities, "jetcaster"),
                undefined,
            );
        });

        it("never sends a set published for another catalog revision", async () => {
            const templates = new UiBuilderTemplates(
                root,
                "https://example.test/catalogs",
                async () => published("revision-2"),
            );
            assert.strictEqual(
                await templates.forTemplate(capabilities, "wear-list"),
                undefined,
            );
        });
    });
});
