# Changelog

## [1.47.1](https://github.com/yschimke/compose-preview-vscode/compare/v1.47.0...v1.47.1) (2026-08-29)


### Bug Fixes

* **ci:** one Renovate config, on the shared preset ([#17](https://github.com/yschimke/compose-preview-vscode/issues/17)) ([2a36ce0](https://github.com/yschimke/compose-preview-vscode/commit/2a36ce08686be4b41d23623b861c380efb6b5857))
* **deps:** pin dependencies ([#11](https://github.com/yschimke/compose-preview-vscode/issues/11)) ([d6a82bd](https://github.com/yschimke/compose-preview-vscode/commit/d6a82bd51fdebc9ff01a260b9751d32966ee8ed7))
* stop release-please opening a phantom release PR ([719ab6b](https://github.com/yschimke/compose-preview-vscode/commit/719ab6b31d2929424f7cd8c47221f90ac381aaf2))
* stop release-please opening a phantom release PR ([b803718](https://github.com/yschimke/compose-preview-vscode/commit/b803718f4f3f1a868a58ea64222c0bf9d54c9d99))

## [1.47.0](https://github.com/yschimke/compose-preview-vscode/compare/v1.46.2...v1.47.0) (2026-08-29)


### Bug Fixes

* tag releases as vX.Y.Z, not compose-preview-vX.Y.Z ([b96f452](https://github.com/yschimke/compose-preview-vscode/commit/b96f4525ef6db78e48a6b5bc0cf7b6771932e0ca))
* tag releases as vX.Y.Z, not compose-preview-vX.Y.Z ([8697f3b](https://github.com/yschimke/compose-preview-vscode/commit/8697f3b0d8d8db59b7b0bc39e69e7625626d1b90))


### Chores

* release 1.47.0 ([f457a91](https://github.com/yschimke/compose-preview-vscode/commit/f457a9112ae9e18d49b70c2df7667908cfbb05f3))

## Changelog

Versions before `1.46.2` were cut from
[`yschimke/compose-ai-tools`](https://github.com/yschimke/compose-ai-tools),
where the extension shared a version and a release train with the Gradle plugin.
Their entries are in [that repository's
CHANGELOG](https://github.com/yschimke/compose-ai-tools/blob/main/CHANGELOG.md).

`1.46.2` is the last release the monorepo published and the baseline this
repository starts from. From here the extension versions independently of the
plugin — see [AGENTS.md](AGENTS.md#releasing).
