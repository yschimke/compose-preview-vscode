#!/usr/bin/env python3
"""Point a consumer's Gradle version catalog at the versions this extension pins.

Used by `scripts/setup-external-e2e.sh` against its throwaway Confetti checkout.

Two trains, two version keys.

Until compose-ai-tools 2.x one version covered the plugin and every library
beside it, and Confetti's catalog says so: a single `composeai-preview` key that
`plugins.composeai-preview` and `libraries.composeai-preview-annotations` both
`version.ref`. Rewriting that one key was therefore enough.

It is not any more. `preview-annotations` moved to
yschimke/compose-preview-daemon and is published on that repository's own 3.x
train, with no release at the plugin's version at all — the plugin train's last
one is 2.4.1. Pointing the single key at a 2.x plugin makes Gradle ask for
`ee.schimke.composeai:preview-annotations:<plugin version>`, which does not
exist, and the consumer fails four minutes into a Gradle run
(compose-preview-vscode#31).

So: set the plugin key, add a daemon key beside it, and repoint the daemon-train
libraries at that. Idempotent — running twice produces the same file.
"""

import re
import sys

PLUGIN_KEY = "composeai-preview"
DAEMON_KEY = "composeai-preview-daemon"
GROUP = "ee.schimke.composeai"
# Published from the daemon repository, so versioned on its train. Not a guess:
# each is a member of `compose-preview-daemon-bom`.
DAEMON_MODULES = ("preview-annotations", "preview-data-api")


def rewrite(text: str, plugin_version: str, daemon_version: str) -> str:
    new, hits = re.subn(
        rf'^(\s*{PLUGIN_KEY}\s*=\s*)"[^"]+"',
        rf'\g<1>"{plugin_version}"',
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if hits == 0:
        raise SystemExit(
            f"{PLUGIN_KEY} entry not found in catalog; refusing to proceed"
        )

    if re.search(rf"^\s*{DAEMON_KEY}\s*=", new, flags=re.MULTILINE):
        new = re.sub(
            rf'^(\s*{DAEMON_KEY}\s*=\s*)"[^"]+"',
            rf'\g<1>"{daemon_version}"',
            new,
            count=1,
            flags=re.MULTILINE,
        )
    else:
        new = re.sub(
            rf'^(\s*{PLUGIN_KEY}\s*=\s*"[^"]+")',
            rf'\g<1>\n{DAEMON_KEY} = "{daemon_version}"',
            new,
            count=1,
            flags=re.MULTILINE,
        )

    for module in DAEMON_MODULES:
        new = re.sub(
            rf'(module\s*=\s*"{re.escape(GROUP)}:{re.escape(module)}"\s*,\s*version\.ref\s*=\s*)"{PLUGIN_KEY}"',
            rf'\g<1>"{DAEMON_KEY}"',
            new,
        )

    # Anything else in the group still riding the plugin's version is a
    # coordinate this script has not classified. Fail loudly rather than resolve
    # it wrongly: a silent miss reappears as an unresolvable dependency minutes
    # into a Gradle run, which is the failure this exists to prevent.
    for line in new.splitlines():
        if f'module = "{GROUP}:' not in line:
            continue
        if f'version.ref = "{PLUGIN_KEY}"' not in line:
            continue
        found = re.search(rf'module\s*=\s*"{re.escape(GROUP)}:([^"]+)"', line)
        name = found.group(1) if found else line.strip()
        raise SystemExit(
            f"catalog entry for {GROUP}:{name} still refs the plugin version. "
            f"Classify it: plugin train (leave it) or daemon train (add it to "
            f"DAEMON_MODULES in {__file__})."
        )

    return new


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        raise SystemExit(
            "usage: rewrite-external-catalog.py <libs.versions.toml> <plugin-version> <daemon-version>"
        )
    path, plugin_version, daemon_version = argv[1], argv[2], argv[3]
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    new = rewrite(text, plugin_version, daemon_version)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(new)


if __name__ == "__main__":
    main(sys.argv)
