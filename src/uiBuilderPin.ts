// The compose-ui-builder web editor release the UI Builder custom editor
// downloads when no local build is configured.
//
// Like `plugin-version.json`, this is a compatibility assertion about another
// repository's releases, so it moves by hand in a reviewable change — never as
// a side effect of a release train. `sha256` is of the release asset itself:
// the archive is ~20 MB of executable Wasm fetched at runtime, and a pin that
// names a version without its bytes would trust whatever that URL serves.
//
// The editor must speak a host-bridge version the extension supports
// (`SUPPORTED_HOST_BRIDGE` in uiBuilderDist.ts); the archive says which in its
// `ui-builder-web.json`. A release that predates the bridge is refused with a
// message that names the `composePreview.uiBuilder.distPath` setting, which is
// the loop for a local compose-ui-builder checkout.

export interface UiBuilderWebPin {
    version: string;
    sha256: string;
}

export const UI_BUILDER_WEB_PIN: UiBuilderWebPin = {
    version: "3.157.0",
    sha256: "607be3da42f1d3d69cbdf164525a525c63f1ff16fe239179a9315e2084c95437",
};

export function uiBuilderWebArchiveUrl(version: string): string {
    return `https://github.com/yschimke/compose-ui-builder/releases/download/v${version}/compose-preview-ui-builder-web-${version}.zip`;
}
