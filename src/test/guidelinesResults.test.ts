// Coverage for the design-guidelines report reader and CLI invocation the Problems panel and the
// "Check Design Guidelines" command rely on. The fixture is a trimmed `guidelines.json` from a
// real `compose-preview guidelines` run on wear-m3-catalog (compose-ai-tools 2.38.0).

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
    OPENROUTER_KEY_ENV,
    annotatedPathFor,
    failingFindings,
    findingMessage,
    functionForFinding,
    guidelinesCliArgs,
    guidelinesCliEnv,
    guidelinesFileCandidates,
    kotlinFileClassName,
    kotlinPackageName,
    parseCatalogRules,
    parseGuidelinesSummary,
    parseModuleGuidelines,
    previewIdMatchesFunction,
    scanFunctionDeclarations,
    sourceFileMatches,
} from "../guidelinesResults";

const fixtures = path.resolve(__dirname, "../../src/test/fixtures/guidelines");
const read = (name: string) =>
    fs.readFileSync(path.join(fixtures, name), "utf-8");
const WEAR_LIST = "ee.schimke.wearm3catalog.sections.ListsKt.WearList_192dp";

describe("guidelinesResults", () => {
    const guidelines = parseModuleGuidelines(read("guidelines.json"))!;
    const rules = parseCatalogRules(read("ui-builder.guidelines.json"));

    it("reads a real guidelines.json", () => {
        assert.ok(guidelines);
        assert.strictEqual(guidelines.catalog, "wear-m3");
        assert.strictEqual(guidelines.results.length, 1);
        assert.strictEqual(guidelines.results[0].previewId, WEAR_LIST);
    });

    it("turns only this preview's fail verdicts into findings", () => {
        const findings = failingFindings(guidelines, rules);
        // pass, needs_evidence, and a fail naming another subject are not this preview's problems.
        assert.deepStrictEqual(
            findings.map((f) => f.ruleId),
            ["wear.layout.time-text-shown", "wear.touch-target-48dp"],
        );
        assert.ok(findings.every((f) => f.previewId === WEAR_LIST));
    });

    it("takes severity and the guide link from the catalog rule", () => {
        const [timeText, touch] = failingFindings(guidelines, rules);
        assert.strictEqual(timeText.severity, "info");
        assert.strictEqual(touch.severity, "warning");
        assert.strictEqual(
            touch.source,
            "https://developer.android.com/design/ui/wear/guides/foundations/touch-targets",
        );
        assert.strictEqual(touch.confidencePercent, 72);
        assert.deepStrictEqual(touch.nodeIds, ["n3"]);
        assert.ok(findingMessage(touch).includes("72% sure"));
        assert.ok(findingMessage(touch).includes(WEAR_LIST));
    });

    it("falls back to warning and no link without the catalog file", () => {
        const [timeText] = failingFindings(guidelines, new Map());
        assert.strictEqual(timeText.severity, "warning");
        assert.strictEqual(timeText.source, null);
    });

    it("refuses a file that is not a guidelines report", () => {
        assert.strictEqual(parseModuleGuidelines('{"previews":[]}'), null);
        assert.strictEqual(parseModuleGuidelines("not json"), null);
    });

    it("maps preview ids, sweeps included, onto their function", () => {
        const cls = "ee.schimke.wearm3catalog.sections.ListsKt";
        assert.ok(previewIdMatchesFunction(WEAR_LIST, cls, "WearList"));
        assert.ok(previewIdMatchesFunction(`${cls}.WearList`, cls, "WearList"));
        assert.ok(
            !previewIdMatchesFunction(
                `${cls}.WearListFast_192dp`,
                cls,
                "WearList",
            ),
        );
        assert.ok(!previewIdMatchesFunction(WEAR_LIST, cls, "Wear"));
    });

    describe("placing a finding on its function", () => {
        const cls = "com.example.CardsKt";
        const doc = "/w/app/src/main/kotlin/com/example/Cards.kt";
        const file = (
            manifestPreviews: {
                id: string;
                className: string;
                functionName: string;
                sourceFile: string | null;
            }[],
        ) => ({
            manifestPreviews,
            isThisFile: (sf: string | null) =>
                sourceFileMatches(sf, doc, "com.example"),
            fileClassNames: [cls],
            packageName: "com.example",
            functions: [
                { functionName: "Card", containers: [] },
                { functionName: "Card_Dark", containers: [] },
                { functionName: "Other", containers: [] },
            ],
        });
        /** The name of the function [previewId] lands on, for readable assertions. */
        const placed = (
            previewId: string,
            f: Parameters<typeof functionForFinding>[1],
        ) => {
            const i = functionForFinding(previewId, f);
            return i === null ? null : f.functions[i].functionName;
        };

        it("takes the function from the manifest, not the id's prefix", () => {
            const f = file([
                {
                    id: `${cls}.Card_Dark`,
                    className: cls,
                    functionName: "Card_Dark",
                    sourceFile: "com/example/Cards.kt",
                },
                {
                    id: `${cls}.Card`,
                    className: cls,
                    functionName: "Card",
                    sourceFile: "com/example/Cards.kt",
                },
            ]);
            assert.strictEqual(placed(`${cls}.Card_Dark`, f), "Card_Dark");
            assert.strictEqual(placed(`${cls}.Card`, f), "Card");
        });

        it("prefers the longest function when the manifest does not list the id", () => {
            const f = file([]);
            assert.strictEqual(placed(`${cls}.Card_Dark`, f), "Card_Dark");
            assert.strictEqual(
                placed(`${cls}.Card_Dark_192dp`, f),
                "Card_Dark",
            );
            assert.strictEqual(placed(`${cls}.Card_192dp`, f), "Card");
            assert.strictEqual(placed("com.other.CardsKt.Card", f), null);
        });

        it("drops a listed preview whose source is another file", () => {
            const f = file([
                {
                    id: `${cls}.Card`,
                    className: cls,
                    functionName: "Card",
                    sourceFile: "com/example/Elsewhere.kt",
                },
            ]);
            assert.strictEqual(placed(`${cls}.Card`, f), null);
        });

        describe("same-named functions in different classes of one file", () => {
            const src = "com/example/Cards.kt";
            // fun Card() at top level, in object Light, and in object Dark's companion.
            const functions = [
                { functionName: "Card", containers: [] },
                { functionName: "Card", containers: ["Light"] },
                { functionName: "Card", containers: ["Dark", "Companion"] },
            ];
            const scoped = (manifestPreviews: Parameters<typeof file>[0]) => ({
                ...file(manifestPreviews),
                functions,
            });

            it("places a listed preview on the function of its class", () => {
                const f = scoped([
                    {
                        id: `${cls}.Card`,
                        className: cls,
                        functionName: "Card",
                        sourceFile: src,
                    },
                    {
                        id: "com.example.Light.Card",
                        className: "com.example.Light",
                        functionName: "Card",
                        sourceFile: src,
                    },
                    {
                        id: "com.example.Dark$Companion.Card",
                        className: "com.example.Dark$Companion",
                        functionName: "Card",
                        sourceFile: src,
                    },
                ]);
                assert.strictEqual(functionForFinding(`${cls}.Card`, f), 0);
                assert.strictEqual(
                    functionForFinding("com.example.Light.Card", f),
                    1,
                );
                assert.strictEqual(
                    functionForFinding("com.example.Dark$Companion.Card", f),
                    2,
                );
            });

            it("places an unlisted id by its class prefix", () => {
                const f = scoped([]);
                assert.strictEqual(
                    functionForFinding("com.example.Light.Card_192dp", f),
                    1,
                );
                assert.strictEqual(
                    functionForFinding("com.example.Dark.Companion.Card", f),
                    2,
                );
                assert.strictEqual(
                    functionForFinding(`${cls}.Card_192dp`, f),
                    0,
                );
                assert.strictEqual(
                    functionForFinding("com.example.Other.Card", f),
                    null,
                );
            });

            it("takes a manifest class no declaration accounts for as the file facade", () => {
                const f = scoped([
                    {
                        id: "com.example.Mystery.Card",
                        className: "com.example.Mystery",
                        functionName: "Card",
                        sourceFile: src,
                    },
                ]);
                assert.strictEqual(
                    functionForFinding("com.example.Mystery.Card", f),
                    0,
                );
            });

            it("still places by name when the symbols carry no nesting", () => {
                const f = {
                    ...file([
                        {
                            id: "com.example.Light.Card",
                            className: "com.example.Light",
                            functionName: "Card",
                            sourceFile: src,
                        },
                    ]),
                    functions: [{ functionName: "Card" }],
                };
                assert.strictEqual(
                    functionForFinding("com.example.Light.Card", f),
                    0,
                );
            });
        });

        it("matches package-qualified and module-relative source paths", () => {
            assert.ok(
                sourceFileMatches("com/example/Cards.kt", doc, "com.example"),
            );
            assert.ok(
                sourceFileMatches(
                    "src/main/kotlin/com/example/Cards.kt",
                    doc,
                    "com.example",
                ),
            );
            assert.ok(
                !sourceFileMatches("com/example/Other.kt", doc, "com.example"),
            );
            assert.ok(!sourceFileMatches(null, doc, "com.example"));
        });

        it("names the file facade class", () => {
            assert.strictEqual(
                kotlinFileClassName("package com.example\n", doc),
                cls,
            );
            assert.strictEqual(
                kotlinFileClassName(
                    '@file:JvmName("CardPreviews")\npackage com.example\n',
                    doc,
                ),
                "com.example.CardPreviews",
            );
            assert.strictEqual(kotlinPackageName("fun x() {}"), null);
        });

        it("finds functions by text when no language server answers", () => {
            const text = [
                "package com.example",
                "",
                "// fun Commented() {}",
                '@Preview(name = "dark")',
                "@Composable",
                "fun Card_Dark() {}",
                "",
                "@Preview @Composable private fun Card() {",
                "}",
                "/*",
                "fun InComment() {}",
                "*/",
                "internal fun <T> List<T>.Other(x: T) {}",
            ].join("\n");
            assert.deepStrictEqual(
                scanFunctionDeclarations(text).map((f) => [
                    f.functionName,
                    f.line,
                ]),
                [
                    ["Card_Dark", 5],
                    ["Card", 7],
                    ["Other", 12],
                ],
            );
            assert.ok(
                scanFunctionDeclarations(text).every(
                    (f) => f.containers.length === 0,
                ),
            );
            const card = scanFunctionDeclarations(text)[1];
            assert.strictEqual(
                text.split("\n")[7].slice(card.nameStart, card.nameStart + 4),
                "Card",
            );
        });

        it("keeps the class or object a scanned function is declared in", () => {
            const text = [
                "package com.example",
                "",
                "data class Point(val x: Int)",
                "",
                "@Composable fun Card() {",
                '    Text("} not a brace {")',
                "}",
                "",
                "object Light {",
                "    @Composable fun Card() {",
                "        Box { }",
                "    }",
                "}",
                "",
                "class Dark(",
                "    val x: Int,",
                ") {",
                "    companion object {",
                "        @Composable fun Card() {}",
                "    }",
                "    fun Member() {}",
                "}",
                "",
                "fun After() {}",
            ].join("\n");
            assert.deepStrictEqual(
                scanFunctionDeclarations(text).map((f) => [
                    f.functionName,
                    f.containers,
                ]),
                [
                    ["Card", []],
                    ["Card", ["Light"]],
                    ["Card", ["Dark", "Companion"]],
                    ["Member", ["Dark"]],
                    ["After", []],
                ],
            );
        });
    });

    it("names the annotated render beside the render", () => {
        assert.strictEqual(
            annotatedPathFor(
                "/m/build/compose-previews/renders/WearList_192dp-97261d54.png",
            ),
            "/m/build/compose-previews/renders/WearList_192dp-97261d54.guidelines.png",
        );
    });

    it("passes the key only through the environment, never as an argument", () => {
        const key = "sk-or-test-not-a-real-key";
        const args = guidelinesCliArgs({
            modulePath: ":catalog",
            filter: "Lists",
            model: "deepseek/deepseek-v4.1-flash",
            maxCost: 0.1,
            guidelinesFile: "/w/ui-builder.guidelines.json",
            surface: "screen",
        });
        assert.ok(args.every((a) => !a.includes(key)));
        assert.deepStrictEqual(args.slice(0, 4), [
            "guidelines",
            "--module",
            ":catalog",
            "--annotate",
        ]);
        assert.ok(args.includes("--filter") && args.includes("--surface"));
        const env = guidelinesCliEnv({ PATH: "/usr/bin" }, key);
        assert.strictEqual(env[OPENROUTER_KEY_ENV], key);
        assert.strictEqual(env.PATH, "/usr/bin");
    });

    it("looks for the catalog file in the build, the module, then the workspace root", () => {
        assert.deepStrictEqual(guidelinesFileCandidates("/w", "catalog"), [
            path.join(
                "/w",
                "catalog",
                "build",
                "compose-previews",
                "ui-builder.guidelines.json",
            ),
            path.join("/w", "catalog", "ui-builder.guidelines.json"),
            path.join("/w", "ui-builder.guidelines.json"),
        ]);
    });

    it("reads the CLI's per-module summary line", () => {
        const stdout =
            "[daemon …] warm\n" +
            "catalog: 5 preview(s) checked against `wear-m3` guidelines v1 — 1 request(s), $0.0427\n" +
            "  ee.schimke.wearm3catalog.sections.ListsKt.WearList_192dp\n";
        assert.deepStrictEqual(parseGuidelinesSummary(stdout), [
            { module: "catalog", previews: 5, requests: 1, costUsd: 0.0427 },
        ]);
    });
});
