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
    guidelinesCliArgs,
    guidelinesCliEnv,
    guidelinesFileCandidates,
    parseCatalogRules,
    parseGuidelinesSummary,
    parseModuleGuidelines,
    previewIdMatchesFunction,
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
