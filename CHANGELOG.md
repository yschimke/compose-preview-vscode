# Changelog

## [1.51.4](https://github.com/yschimke/compose-preview-vscode/compare/v1.51.3...v1.51.4) (2026-10-30)


### Bug Fixes

* **deps:** update dependency three to v0.187.0 ([#107](https://github.com/yschimke/compose-preview-vscode/issues/107)) ([b8a77b6](https://github.com/yschimke/compose-preview-vscode/commit/b8a77b6e7578614e1e0dd504ecdc7d5164c45d27))

## [1.51.3](https://github.com/yschimke/compose-preview-vscode/compare/v1.51.2...v1.51.3) (2026-10-24)


### Bug Fixes

* give the cold-start Gradle bootstrap room, say it is running, and retry it after a failure ([#93](https://github.com/yschimke/compose-preview-vscode/issues/93)) ([3fe2a0d](https://github.com/yschimke/compose-preview-vscode/commit/3fe2a0d962318cccd618020d27fe4fccf79d6c04))
* name Gradle's root cause when a task or the marker bootstrap fails ([#96](https://github.com/yschimke/compose-preview-vscode/issues/96)) ([e03dea7](https://github.com/yschimke/compose-preview-vscode/commit/e03dea7ee360b25e37c4329ada743a9dc87cae84))
* replace "Configuring Gradle…" when the marker bootstrap fails ([#95](https://github.com/yschimke/compose-preview-vscode/issues/95)) ([7c3cba0](https://github.com/yschimke/compose-preview-vscode/commit/7c3cba0456380f6d193e58f90260a95f3d8718ef))

## [1.51.2](https://github.com/yschimke/compose-preview-vscode/compare/v1.51.1...v1.51.2) (2026-10-24)


### Bug Fixes

* adopt compose-ai-tools 2.74.0 ([#91](https://github.com/yschimke/compose-preview-vscode/issues/91)) ([11e58ab](https://github.com/yschimke/compose-preview-vscode/commit/11e58ab3babe49618ac46e53c50e1c524cf36134))

## [1.51.1](https://github.com/yschimke/compose-preview-vscode/compare/v1.51.0...v1.51.1) (2026-10-24)


### Bug Fixes

* adopt compose-ai-tools 2.73.2 ([#90](https://github.com/yschimke/compose-preview-vscode/issues/90)) ([e281de0](https://github.com/yschimke/compose-preview-vscode/commit/e281de01f4dd184e550654d2ace19a753434b4b6))
* only reset an incremental cache a produced descriptor names, inside the module ([#85](https://github.com/yschimke/compose-preview-vscode/issues/85)) ([2d464f4](https://github.com/yschimke/compose-preview-vscode/commit/2d464f4bb343e468ef3c4f92580ec1da8f5042c3))
* respawn the daemon only when its launch shape changes ([#86](https://github.com/yschimke/compose-preview-vscode/issues/86)) ([6dbbeee](https://github.com/yschimke/compose-preview-vscode/commit/6dbbeee048a182f0e7e3a9c33cb6ea9d64ab4695))
* send compileSources the whole module, and recover a cache built without it ([#84](https://github.com/yschimke/compose-preview-vscode/issues/84)) ([54ac594](https://github.com/yschimke/compose-preview-vscode/commit/54ac594e1b67afb7e00bf80fb0f0cec76b8a76f4))


### Performance

* adopt compose-ai-tools 2.73.1 (daemon 3.24.2) ([#88](https://github.com/yschimke/compose-preview-vscode/issues/88)) ([4d6a314](https://github.com/yschimke/compose-preview-vscode/commit/4d6a3143660ba1ae437a5221d8cdf063fdc1aeaf))
* drop the save debounce and unrequested data products from the edit loop ([#89](https://github.com/yschimke/compose-preview-vscode/issues/89)) ([f00d130](https://github.com/yschimke/compose-preview-vscode/commit/f00d130d28fe35439e79a3ee21e21794ca41771b))
* focus the edited preview on save, not every preview in the file ([#87](https://github.com/yschimke/compose-preview-vscode/issues/87)) ([036816e](https://github.com/yschimke/compose-preview-vscode/commit/036816e140abaab9fc69effd8fd1ee27a954b742))
* let the daemon's warm compiler take in-process compiles ([#82](https://github.com/yschimke/compose-preview-vscode/issues/82)) ([29fd4c2](https://github.com/yschimke/compose-preview-vscode/commit/29fd4c2f4e02a6a663e1ed02153f34885d4329b2))
* stop a save during reconcile from forcing a full rediscover ([#79](https://github.com/yschimke/compose-preview-vscode/issues/79)) ([39bbea6](https://github.com/yschimke/compose-preview-vscode/commit/39bbea64933991661ef028c0a76cc16a129c2416))

## [1.51.0](https://github.com/yschimke/compose-preview-vscode/compare/v1.50.1...v1.51.0) (2026-10-21)


### Features

* **ui-builder:** seed new designs from the catalog's published templates ([#74](https://github.com/yschimke/compose-preview-vscode/issues/74)) ([c7c1f8a](https://github.com/yschimke/compose-preview-vscode/commit/c7c1f8a03bbbf63ba47c431eecb78ddce59f0d2b))


### Bug Fixes

* load VS Code UI Builder catalogs from published service ([#68](https://github.com/yschimke/compose-preview-vscode/issues/68)) ([c9fe135](https://github.com/yschimke/compose-preview-vscode/commit/c9fe1353ad25911a772173597789056426ef38bb))

## [1.50.1](https://github.com/yschimke/compose-preview-vscode/compare/v1.50.0...v1.50.1) (2026-10-11)


### Bug Fixes

* **daemon:** only spawn from a launch descriptor this extension's Gradle run wrote ([#61](https://github.com/yschimke/compose-preview-vscode/issues/61)) ([af846dd](https://github.com/yschimke/compose-preview-vscode/commit/af846dd378fa111383ecc57db9e0340d13f89963))

## [1.50.0](https://github.com/yschimke/compose-preview-vscode/compare/v1.49.0...v1.50.0) (2026-10-10)


### Features

* **guidelines:** design-guidelines findings in the Problems panel, and a check command ([#56](https://github.com/yschimke/compose-preview-vscode/issues/56)) ([a990c54](https://github.com/yschimke/compose-preview-vscode/commit/a990c54df4e4752971bcde4a50f18bf05ddb0f04))


### Bug Fixes

* **guidelines:** keep the key's CLI path and spend limit out of workspace settings ([#59](https://github.com/yschimke/compose-preview-vscode/issues/59)) ([9d07206](https://github.com/yschimke/compose-preview-vscode/commit/9d072067f21ce3e9152c318eb3dbfc5cafc41dc2))
* **guidelines:** place findings by class and function, not function name alone ([#58](https://github.com/yschimke/compose-preview-vscode/issues/58)) ([1e59383](https://github.com/yschimke/compose-preview-vscode/commit/1e5938322ceabbf2e308a5b4e3e432cd42468c87))
* **guidelines:** place findings without the preview panel, and bootstrap before the check ([#57](https://github.com/yschimke/compose-preview-vscode/issues/57)) ([431b066](https://github.com/yschimke/compose-preview-vscode/commit/431b066cce29eccc5cea2f11537a4e76cff0cc50))
* resolve extension runtime pins through the latest tools BOM ([#51](https://github.com/yschimke/compose-preview-vscode/issues/51)) ([2e940ef](https://github.com/yschimke/compose-preview-vscode/commit/2e940efb1e7ad7fe9276b2e694fa0eb391eba51b))
* track published plugin markers with reviewed Renovate upgrades ([403be90](https://github.com/yschimke/compose-preview-vscode/commit/403be906e7b03fc2d1136e64d5a5b556d9b8532e))

## [1.49.0](https://github.com/yschimke/compose-preview-vscode/compare/v1.48.0...v1.49.0) (2026-09-26)


### Features

* open generated Kotlin in an editor ([#48](https://github.com/yschimke/compose-preview-vscode/issues/48)) ([d8315ae](https://github.com/yschimke/compose-preview-vscode/commit/d8315ae93cbbe4d378d3c35502044dff694d0569))
* split UI Builder into its own sidebar ([#46](https://github.com/yschimke/compose-preview-vscode/issues/46)) ([8e9b736](https://github.com/yschimke/compose-preview-vscode/commit/8e9b736b431781ae864d839949c9b71a2bc724e6))


### Bug Fixes

* compare daemon versions in compatibility warning ([#45](https://github.com/yschimke/compose-preview-vscode/issues/45)) ([452c4aa](https://github.com/yschimke/compose-preview-vscode/commit/452c4aadfee50a15cefbc64dffec382dd75753bf))
* support VS Code 1.115 ([#44](https://github.com/yschimke/compose-preview-vscode/issues/44)) ([fce6ad6](https://github.com/yschimke/compose-preview-vscode/commit/fce6ad6c0ebf76c037961265f97b3a7a4f461246))

## [1.48.0](https://github.com/yschimke/compose-preview-vscode/compare/v1.47.1...v1.48.0) (2026-09-26)


### Features

* **ui-builder:** open .uid designs in the Compose UI Builder, as an editor plus views (early access) ([#35](https://github.com/yschimke/compose-preview-vscode/issues/35)) ([c8c5183](https://github.com/yschimke/compose-preview-vscode/commit/c8c5183bffa30b5b2767798cb8a30195e0e6b2c9))

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
