// Pins the pure halves of the early-access UI Builder: the archive reader,
// the archive resolver, the webview page, the design model behind the Layers
// view, and the document <-> editor sync. The Wasm half is exercised in a
// real browser by spikes/ui-builder-wasm/bridge.mjs.

import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import {
    componentLabel,
    designIdFor,
    layerTree,
    parseDesign,
    type DesignDocument,
} from "../uiBuilderDesign";
import { resolveUiBuilderDist, UiBuilderDistError } from "../uiBuilderDist";
import {
    actionContextValues,
    commandEnablement,
    menuGroup,
    menuWhen,
    UI_BUILDER_CHROME_COMMANDS,
} from "../uiBuilderChrome";
import {
    UI_BUILDER_THEME_PALETTE,
    UI_BUILDER_THEME_ROLES,
    uiBuilderCsp,
    uiBuilderWebviewHtml,
} from "../uiBuilderHtml";
import { UiBuilderDocumentSync } from "../uiBuilderSync";
import { isSafeEntryName, readZip } from "../uiBuilderZip";

/** A minimal ZIP writer, so the reader is tested against real bytes. */
function zip(
    entries: { name: string; data: string | Buffer; store?: boolean }[],
): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const data = Buffer.isBuffer(entry.data)
            ? entry.data
            : Buffer.from(entry.data);
        const body = entry.store ? data : zlib.deflateRawSync(data);
        const name = Buffer.from(entry.name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(entry.store ? 0 : 8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(entry.store ? 0 : 8, 10);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, body);
        centrals.push(central, name);
        offset += local.length + name.length + body.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

const MANIFEST_WITH_BRIDGE =
    '{"schema":"compose-ui-builder-web/v1","version":"9.9.9","serverApi":1,"hostBridge":1}';
const MANIFEST_WITHOUT_BRIDGE =
    '{"schema":"compose-ui-builder-web/v1","version":"3.48.0","serverApi":1}';

function archive(manifest: string): Buffer {
    return zip([
        { name: "index.html", data: "<html><head></head><body></body></html>" },
        { name: "ui-builder-web.json", data: manifest, store: true },
        { name: "fonts/", data: "", store: true },
        { name: "fonts/fonts.json", data: "{}" },
    ]);
}

describe("uiBuilderZip", () => {
    it("reads stored and deflated entries and skips directories", () => {
        const entries = readZip(archive(MANIFEST_WITH_BRIDGE));
        assert.deepStrictEqual(
            entries.map((e) => e.name),
            ["index.html", "ui-builder-web.json", "fonts/fonts.json"],
        );
        assert.strictEqual(
            entries[1].data.toString("utf8"),
            MANIFEST_WITH_BRIDGE,
        );
    });

    it("refuses entries that would escape the extraction root", () => {
        assert.throws(
            () => readZip(zip([{ name: "../evil.js", data: "x" }])),
            /unsafe entry name/,
        );
        for (const name of ["/abs", "a\\b", "C:/x", "a/../../b", ""]) {
            assert.strictEqual(isSafeEntryName(name), false, name);
        }
        assert.strictEqual(isSafeEntryName("composeResources/a..b.txt"), true);
    });

    it("refuses bytes that are not a zip", () => {
        assert.throws(
            () => readZip(Buffer.from("not a zip at all, clearly")),
            /not a zip/,
        );
    });
});

describe("uiBuilderDist", () => {
    let storage: string;
    beforeEach(async () => {
        storage = await fs.mkdtemp(path.join(os.tmpdir(), "ui-builder-dist-"));
    });
    afterEach(async () => {
        await fs.rm(storage, { recursive: true, force: true });
    });

    const noDownload = async (): Promise<Buffer> => {
        throw new Error("unexpected download");
    };

    it("uses a configured directory as it stands", async () => {
        const dir = path.join(storage, "dist");
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, "ui-builder-web.json"),
            MANIFEST_WITH_BRIDGE,
        );
        const dist = await resolveUiBuilderDist({
            configuredPath: dir,
            storageRoot: path.join(storage, "store"),
            download: noDownload,
            log: () => undefined,
        });
        assert.strictEqual(dist.root, dir);
        assert.strictEqual(dist.manifest.hostBridge, 1);
    });

    it("unpacks a configured zip, keyed by its bytes", async () => {
        const file = path.join(storage, "web.zip");
        await fs.writeFile(file, archive(MANIFEST_WITH_BRIDGE));
        const dist = await resolveUiBuilderDist({
            configuredPath: file,
            storageRoot: path.join(storage, "store"),
            download: noDownload,
            log: () => undefined,
        });
        assert.strictEqual(
            await fs.readFile(
                path.join(dist.root, "fonts", "fonts.json"),
                "utf8",
            ),
            "{}",
        );
    });

    it("refuses an editor without the host bridge, naming the setting", async () => {
        const file = path.join(storage, "web.zip");
        await fs.writeFile(file, archive(MANIFEST_WITHOUT_BRIDGE));
        await assert.rejects(
            resolveUiBuilderDist({
                configuredPath: file,
                storageRoot: path.join(storage, "store"),
                download: noDownload,
                log: () => undefined,
            }),
            (error: Error) =>
                error instanceof UiBuilderDistError &&
                /predates the host bridge/.test(error.message) &&
                /webDistPath/.test(error.message),
        );
    });

    it("downloads the pin once and verifies its sha256", async () => {
        const bytes = archive(MANIFEST_WITH_BRIDGE);
        const pin = {
            version: "9.9.9",
            sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        };
        const urls: string[] = [];
        const options = {
            configuredPath: "",
            storageRoot: storage,
            pin,
            download: async (url: string) => {
                urls.push(url);
                return bytes;
            },
            log: () => undefined,
        };
        const first = await resolveUiBuilderDist(options);
        const second = await resolveUiBuilderDist(options);
        assert.strictEqual(first.root, second.root);
        assert.deepStrictEqual(urls, [
            "https://github.com/yschimke/compose-ui-builder/releases/download/v9.9.9/compose-preview-ui-builder-web-9.9.9.zip",
        ]);
    });

    it("refuses a download whose bytes are not the pinned ones", async () => {
        await assert.rejects(
            resolveUiBuilderDist({
                configuredPath: "",
                storageRoot: storage,
                pin: { version: "9.9.9", sha256: "0".repeat(64) },
                download: async () => archive(MANIFEST_WITH_BRIDGE),
                log: () => undefined,
            }),
            /Refusing to run it/,
        );
        assert.deepStrictEqual(await fs.readdir(storage), []);
    });
});

describe("uiBuilderHtml", () => {
    const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <script type="importmap">{ "imports": { "@js-joda/core": "./js-joda.esm.js" } }</script>
  </head>
  <body>
    <div id="composeApp"></div>
    <script type="module" src="uiBuilder.mjs"></script>
  </body>
</html>`;

    const html = uiBuilderWebviewHtml({
        indexHtml,
        baseHref: "https://resource.example/dist/",
        cspSource: "https://resource.example",
        nonce: "N0NCE",
        role: "preview",
    });

    it("nonces every script, the importmap included", () => {
        const scripts = html.match(/<script\b[^>]*>/g) ?? [];
        assert.strictEqual(scripts.length, 3);
        for (const tag of scripts) assert.match(tag, /nonce="N0NCE"/);
    });

    it("bases relative URLs on the archive and defines the host before the module", () => {
        assert.match(html, /<base href="https:\/\/resource.example\/dist\/">/);
        assert.ok(
            html.indexOf("composeUiBuilderHost") <
                html.indexOf("uiBuilder.mjs"),
        );
        assert.match(html, /role: "preview"/);
    });

    it("lets Wasm compile and modules import from the resource origin only", () => {
        const csp = uiBuilderCsp("https://resource.example", "N0NCE");
        assert.match(
            csp,
            /script-src 'nonce-N0NCE' 'wasm-unsafe-eval' https:\/\/resource.example/,
        );
        assert.match(csp, /default-src 'none'/);
        assert.doesNotMatch(csp, /(^|\s)'unsafe-eval'/);
    });

    it("sends only theme roles and palette names the editor reads", () => {
        // compose-ui-builder HostBridgeTheme.kt `withRole` and UiBuilderEditorPalette.
        const editorRoles = new Set([
            "primary",
            "onPrimary",
            "primaryContainer",
            "onPrimaryContainer",
            "inversePrimary",
            "secondary",
            "onSecondary",
            "secondaryContainer",
            "onSecondaryContainer",
            "tertiary",
            "onTertiary",
            "tertiaryContainer",
            "onTertiaryContainer",
            "background",
            "onBackground",
            "surface",
            "onSurface",
            "surfaceVariant",
            "onSurfaceVariant",
            "surfaceTint",
            "inverseSurface",
            "inverseOnSurface",
            "error",
            "onError",
            "errorContainer",
            "onErrorContainer",
            "outline",
            "outlineVariant",
            "scrim",
            "surfaceContainerLowest",
            "surfaceContainerLow",
            "surfaceContainer",
            "surfaceContainerHigh",
            "surfaceContainerHighest",
        ]);
        const editorPalette = new Set([
            "workspace",
            "layerSelected",
            "layerDragged",
            "dropTarget",
            "sessionBadge",
            "onSessionBadge",
        ]);
        for (const role of Object.keys(UI_BUILDER_THEME_ROLES)) {
            assert.ok(editorRoles.has(role), role);
        }
        for (const name of Object.keys(UI_BUILDER_THEME_PALETTE)) {
            assert.ok(editorPalette.has(name), name);
        }
    });

    it("reads the theme with a colour pattern that survives the template literal", () => {
        // `\\d` in the bootstrap's template literal reached the page as `d`
        // and matched nothing, so every theme colour was silently dropped.
        assert.match(html, /color\.match\(\/\[0-9\.\]\+\/g\)/);
        assert.match(html, /readTheme/);
    });

    it("refuses a base that would drop the last path segment", () => {
        assert.throws(() =>
            uiBuilderWebviewHtml({
                indexHtml,
                baseHref: "https://resource.example/dist",
                cspSource: "x",
                nonce: "n",
                role: "editor",
            }),
        );
    });
});

const DESIGN: DesignDocument = {
    schema: "compose-ui-builder-document/v1-candidate",
    id: "state-actions",
    title: "State actions",
    catalogPin: { systemId: "m3-catalog" },
    roots: ["scaffold"],
    nodes: {
        scaffold: {
            id: "scaffold",
            componentId: "layout/scaffold",
            slots: { topBar: [], content: ["column"] },
        },
        column: {
            id: "column",
            componentId: "layout/column",
            slots: { children: ["button", "progress"] },
        },
        button: {
            id: "button",
            componentId: "m3/button",
            properties: { text: { type: "literal", value: "Ready" } },
            slots: {},
        },
        progress: {
            id: "progress",
            componentId: "m3/linear-progress-indicator",
        },
    },
};

describe("uiBuilderDesign", () => {
    it("tells empty, invalid and design text apart", () => {
        assert.strictEqual(parseDesign("  \n").kind, "empty");
        assert.strictEqual(parseDesign("{").kind, "invalid");
        assert.strictEqual(
            parseDesign('{"schema":"something-else"}').kind,
            "invalid",
        );
        assert.strictEqual(parseDesign(JSON.stringify(DESIGN)).kind, "design");
        for (const nodes of [null, [], "x"]) {
            assert.strictEqual(
                parseDesign(JSON.stringify({ ...DESIGN, nodes })).kind,
                "invalid",
                JSON.stringify(nodes),
            );
        }
        assert.strictEqual(
            parseDesign(JSON.stringify({ ...DESIGN, roots: [1] })).kind,
            "invalid",
        );
    });

    it("draws slots only where a node has several, like the editor's Layers dock", () => {
        const [scaffold] = layerTree(DESIGN);
        assert.deepStrictEqual(
            scaffold.children.map((c) => [c.kind, c.label, c.description]),
            [
                ["slot", "topBar", "empty"],
                ["slot", "content", ""],
            ],
        );
        const column = scaffold.children[1].children[0];
        assert.strictEqual(column.label, "Column");
        assert.deepStrictEqual(
            column.children.map((c) => [c.label, c.description]),
            [
                ["Button", 'button · "Ready"'],
                ["Linear progress indicator", "progress"],
            ],
        );
    });

    it("draws malformed nodes and slots without throwing", () => {
        const malformed = {
            ...DESIGN,
            roots: ["a", "missing"],
            nodes: {
                a: { id: "a", slots: { children: "b", other: [1, "b"] } },
                b: null,
            },
        } as unknown as DesignDocument;
        const [a] = layerTree(malformed);
        assert.strictEqual(a.label, "A");
        assert.deepStrictEqual(
            a.children.map((c) => [c.label, c.children.length]),
            [
                ["children", 0],
                ["other", 0],
            ],
        );
    });

    it("draws a node reached twice once", () => {
        const cyclic: DesignDocument = {
            ...DESIGN,
            roots: ["column", "column"],
        };
        assert.strictEqual(layerTree(cyclic).length, 1);
    });

    it("names components and design ids readably", () => {
        assert.strictEqual(componentLabel("m3/icon-button"), "Icon button");
        assert.strictEqual(designIdFor("Home Screen.uid"), "home-screen");
        assert.strictEqual(designIdFor("---.uid"), "design");
    });
});

describe("UiBuilderDocumentSync", () => {
    const text = JSON.stringify(DESIGN);

    function harness(initial = text) {
        let documentText = initial;
        const applied: string[] = [];
        const opened: string[] = [];
        const statuses: (string | undefined)[] = [];
        const timers: (() => void)[] = [];
        let resolveApply: ((ok: boolean) => void) | undefined;
        const sync = new UiBuilderDocumentSync({
            readText: () => documentText,
            applyText: (next) =>
                new Promise<boolean>((resolve) => {
                    applied.push(next);
                    resolveApply = (ok) => {
                        if (ok) {
                            documentText = next;
                            sync.documentChanged();
                        }
                        resolve(ok);
                    };
                }),
            openInEditor: (_design, openedText) => opened.push(openedText),
            showStatus: (message) => statuses.push(message),
            setTimer: (callback) => timers.push(callback) - 1,
            clearTimer: (handle) => {
                timers[handle as number] = () => undefined;
            },
        });
        return {
            sync,
            applied,
            opened,
            statuses,
            timers,
            finishApply: async (ok = true) => {
                resolveApply?.(ok);
                await new Promise((r) => setImmediate(r));
            },
            setText: (next: string) => {
                documentText = next;
                sync.documentChanged();
            },
        };
    }

    const edited = (title: string) => JSON.stringify({ ...DESIGN, title });

    it("writes the editor's edits and does not echo them back", async () => {
        const h = harness();
        h.sync.editorChanged(edited("one"));
        await h.finishApply();
        assert.deepStrictEqual(h.applied, [edited("one")]);
        assert.strictEqual(
            h.timers.length,
            0,
            "an echo must not schedule a reload",
        );
    });

    it("applies only the latest of a burst of edits made while one is applying", async () => {
        const h = harness();
        h.sync.editorChanged(edited("a"));
        h.sync.editorChanged(edited("b"));
        h.sync.editorChanged(edited("c"));
        await h.finishApply();
        await h.finishApply();
        assert.deepStrictEqual(h.applied, [edited("a"), edited("c")]);
        assert.strictEqual(h.timers.length, 0);
    });

    it("sends an external change to the editor once typing pauses", () => {
        const h = harness();
        h.setText(edited("typed 1"));
        h.setText(edited("typed 2"));
        h.timers.forEach((t) => t());
        assert.deepStrictEqual(h.opened, [edited("typed 2")]);
    });

    it("keeps the last valid design while the text is broken, and does not overwrite it", () => {
        const h = harness();
        h.setText("{ broken");
        h.timers.forEach((t) => t());
        assert.deepStrictEqual(h.opened, []);
        assert.match(h.statuses.at(-1) ?? "", /last valid version/);
        h.sync.editorChanged(edited("from canvas"));
        assert.deepStrictEqual(h.applied, []);
        assert.match(h.statuses.at(-1) ?? "", /not saved/);
    });

    it("does not write the canvas back over a file emptied in the text editor", () => {
        const h = harness();
        h.setText("");
        h.timers.forEach((t) => t());
        assert.match(h.statuses.at(-1) ?? "", /file is empty/);
        h.sync.editorChanged(edited("stale canvas"));
        assert.deepStrictEqual(h.applied, []);
    });

    it("says so when VS Code refuses an edit", async () => {
        const h = harness();
        h.sync.editorChanged(edited("refused"));
        await h.finishApply(false);
        assert.match(h.statuses.at(-1) ?? "", /refused/);
    });
});

describe("uiBuilderChrome", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../package.json") as {
        contributes: {
            commands: {
                command: string;
                title: string;
                icon?: string;
                enablement?: string;
            }[];
            menus: Record<
                string,
                { command: string; when?: string; group?: string }[]
            >;
            viewsContainers: {
                activitybar: { id: string; title: string; when?: string }[];
            };
            views: Record<string, { id: string }[]>;
        };
    };

    it("keeps UI Builder views out of the Compose Preview container", () => {
        const previewViews = pkg.contributes.views["compose-preview"].map(
            (view) => view.id,
        );
        assert.deepStrictEqual(previewViews, [
            "composePreview.panel",
            "composePreview.historyPanel",
        ]);
        assert.deepStrictEqual(
            pkg.contributes.views["compose-ui-builder"].map((view) => view.id),
            [
                "composePreview.uiBuilder.layers",
                "composePreview.uiBuilder.preview",
            ],
        );
        assert.ok(
            pkg.contributes.viewsContainers.activitybar.some(
                (container) =>
                    container.id === "compose-ui-builder" &&
                    container.when ===
                        "config.composePreview.earlyFeatures.enabled",
            ),
            "expected an early-access Compose UI Builder activity-bar container",
        );
    });

    it("declares every chrome command in package.json, as the table says", () => {
        for (const entry of UI_BUILDER_CHROME_COMMANDS) {
            const declared = pkg.contributes.commands.find(
                (c) => c.command === entry.command,
            );
            assert.ok(declared, ` is not declared`);
            assert.strictEqual(declared.title, entry.title);
            assert.strictEqual(declared.icon, entry.icon);
            assert.strictEqual(declared.enablement, commandEnablement(entry));
            const menu = pkg.contributes.menus["editor/title"].find(
                (m) => m.command === entry.command,
            );
            assert.ok(menu, `${entry.command} has no editor/title entry`);
            assert.strictEqual(menu.when, menuWhen(entry));
            assert.strictEqual(menu.group, menuGroup(entry));
        }
    });

    it("shows one of each show/hide pair, by the panel's state", () => {
        const show = UI_BUILDER_CHROME_COMMANDS.find(
            (c) => c.command === "composePreview.uiBuilder.showProperties",
        )!;
        const hide = UI_BUILDER_CHROME_COMMANDS.find(
            (c) => c.command === "composePreview.uiBuilder.hideProperties",
        )!;
        assert.match(
            menuWhen(show),
            /!composePreview\.uiBuilder\.action\.dock\.properties\.checked/,
        );
        assert.match(
            menuWhen(hide),
            /&& composePreview\.uiBuilder\.action\.dock\.properties\.checked$/,
        );
    });

    it("derives present/enabled/checked keys, and turns off what the editor stopped publishing", () => {
        const values = actionContextValues([
            {
                id: "undo",
                label: "Undo",
                group: "toolbar",
                icon: "Undo",
                enabled: false,
                checked: null,
                badge: 0,
                shortcut: "",
            },
            {
                id: "dock.properties",
                label: "Properties",
                group: "dock",
                icon: "Properties",
                enabled: true,
                checked: true,
                badge: 0,
                shortcut: "",
            },
            {
                id: "some.future.action",
                label: "?",
                group: "overflow",
                icon: "More",
                enabled: true,
                checked: null,
                badge: 0,
                shortcut: "",
            },
        ]);
        assert.strictEqual(
            values.get("composePreview.uiBuilder.action.undo.present"),
            true,
        );
        assert.strictEqual(
            values.get("composePreview.uiBuilder.action.undo.enabled"),
            false,
        );
        assert.strictEqual(
            values.get(
                "composePreview.uiBuilder.action.dock.properties.checked",
            ),
            true,
        );
        assert.strictEqual(
            values.get("composePreview.uiBuilder.action.reference.present"),
            false,
        );
        assert.ok(![...values.keys()].some((k) => k.includes("some.future")));
        assert.deepStrictEqual(
            [...actionContextValues(undefined).values()].filter(Boolean),
            [],
        );
    });
});
