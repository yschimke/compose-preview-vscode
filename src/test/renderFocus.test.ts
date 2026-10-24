import * as assert from "assert";
import { focusedPreviewIds, isPreviewOfFunction } from "../renderFocus";

describe("renderFocus", () => {
    const ids = [
        "dev.app.BackgroundKt.BackgroundDefault_Dark theme",
        "dev.app.BackgroundKt.BackgroundDefault_Light theme",
        "dev.app.BackgroundKt.BackgroundDynamic_Dark theme",
        "dev.app.BackgroundKt.Probe",
    ];

    it("matches named and unnamed previews of a function", () => {
        assert.ok(isPreviewOfFunction(ids[0], "BackgroundDefault"));
        assert.ok(isPreviewOfFunction(ids[3], "Probe"));
        assert.ok(!isPreviewOfFunction(ids[2], "BackgroundDefault"));
        assert.ok(!isPreviewOfFunction(ids[0], "Background"));
    });

    it("focuses the edited function's previews and the scoped card", () => {
        assert.deepStrictEqual(
            focusedPreviewIds(ids, "BackgroundDefault", ids[3]),
            [ids[0], ids[1], ids[3]],
        );
    });

    it("focuses nothing when a helper is edited and no card is scoped", () => {
        assert.deepStrictEqual(
            focusedPreviewIds(ids, "ConfettiTheme", undefined),
            [],
        );
    });
});
