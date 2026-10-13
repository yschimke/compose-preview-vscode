import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { requestCatalogs, UiBuilderCatalogs } from "../uiBuilderCatalogs";

const catalog = (systemId: string) => ({
    schema: "compose-ui-builder-capabilities/v1-candidate",
    benchmark: { catalogSystemId: systemId },
    components: [],
});

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
        const first = await online.load("wear-m3");
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
        assert.strictEqual(await offline.load("wear-m3"), first);
        await assert.rejects(offline.load("remote-m3"), /not been cached/);
    });

    it("rejects a missing or mismatched catalog without replacing its cache", async () => {
        const first = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("wear-m3")],
        }));
        const saved = await first.load("wear-m3");
        const missing = new UiBuilderCatalogs(root, "test", async () => ({
            catalogs: [catalog("remote-m3")],
        }));
        await assert.rejects(missing.load("wear-m3"), /does not serve/);
        const [source] = await fs.readdir(root);
        assert.strictEqual(
            await fs.readFile(path.join(root, source, "wear-m3.json"), "utf8"),
            saved,
        );
        await assert.rejects(missing.load("../wear-m3"), /invalid catalog id/);
    });

    it("keeps caches from different catalog servers separate", async () => {
        await new UiBuilderCatalogs(
            root,
            "https://one.test/requests",
            async () => ({
                catalogs: [catalog("wear-m3")],
            }),
        ).load("wear-m3");
        const another = new UiBuilderCatalogs(
            root,
            "https://two.test/requests",
            async () => {
                throw new Error("offline");
            },
        );
        await assert.rejects(another.load("wear-m3"), /not been cached/);
    });
});
