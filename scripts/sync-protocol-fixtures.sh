#!/usr/bin/env bash
# Refresh the vendored daemon protocol fixtures from yschimke/compose-preview-daemon
# at the release named by `composePreviewDaemon` in `plugin-version.json`.
# See protocol-fixtures/README.md.
#
# These used to come from yschimke/compose-ai-tools at `v${composeAiPlugin}`, which
# was right while the daemon was built there. compose-ai-tools has since extracted
# the daemon into its own repository and its own 3.x release train, so the fixtures
# moved with the wire they describe, and the plugin's version no longer names a tag
# that contains them.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -e 'process.stdout.write(require("'"$repo_root"'/plugin-version.json").composePreviewDaemon)')"
tag="v${version}"
dest="$repo_root/protocol-fixtures"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[sync-protocol-fixtures] fetching docs/daemon/protocol-fixtures at compose-preview-daemon $tag" >&2
git -C "$tmp" init -q .
git -C "$tmp" remote add origin https://github.com/yschimke/compose-preview-daemon.git
git -C "$tmp" fetch -q --depth 1 origin "refs/tags/$tag"
git -C "$tmp" checkout -q FETCH_HEAD -- docs/daemon/protocol-fixtures

src="$tmp/docs/daemon/protocol-fixtures"
[[ -d "$src" ]] || { echo "[sync-protocol-fixtures] $tag has no docs/daemon/protocol-fixtures" >&2; exit 1; }

# Delete first, so a fixture REMOVED upstream disappears here too. Copying over the
# top would leave it behind, and a fixture the daemon no longer speaks is exactly
# the drift this is meant to catch.
rm -f "$dest"/*.json
cp "$src"/*.json "$dest"/
cp "$src/README.md" "$dest/UPSTREAM_README.md"

echo "[sync-protocol-fixtures] synced $(ls -1 "$dest"/*.json | wc -l) fixtures from $tag" >&2
