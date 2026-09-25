# Testing the UI Builder in a real VS Code

Instructions for an agent (or a person) with a **real VS Code on a desktop**, with
a GPU, a display, and the ability to click and take screenshots. They cover what
the cloud sandbox that built the UI Builder could not run. Everything below the
webview's page was checked there in Chromium
([`spikes/ui-builder-wasm/bridge.mjs`](../spikes/ui-builder-wasm/bridge.mjs)).
None of it has run inside VS Code itself:

- the `vscode-webview://` origin, `asWebviewUri` and `localResourceRoots`;
- the editor-title buttons and the "…" menu, which VS Code draws;
- the **Design Layers** tree and the **Design Preview** view;
- dirty state, save, revert, undo from the Edit menu, and the text editor open
  beside the visual one;
- a live theme switch in the real workbench.

Work through [the checklist](#checklist) in order, then fill in
[the report](#report). A check you cannot run is reported as *not run* with the
reason, never as passed.

## Setup

You need Node 22+, a VS Code (stable) on `PATH` as `code`, and network access to:

- `github.com`, for the clone and the editor download (~20 MB, once);
- the npm registry (`registry.npmjs.org`), for `npm ci`;
- the VS Code Marketplace, to install the extension's `vscjava.vscode-gradle`
  dependency.

```sh
git clone https://github.com/yschimke/compose-preview-vscode.git
cd compose-preview-vscode
npm ci
npm run package                      # writes compose-preview-<version>.vsix
```

Use a **fresh profile** so no other extension or old setting interferes. Install
into that profile (an install without `--profile` goes to the default one), then
open the sample designs **as a folder**. The extension does not activate without
a workspace folder.

```sh
code --profile ui-builder-test --install-extension compose-preview-*.vsix --force
code --profile ui-builder-test docs/ui-builder-testing
```

The extension declares `vscjava.vscode-gradle` as a dependency, so VS Code
installs that too; nothing Gradle-related is needed for the UI Builder.

In that window, turn on early features, which the UI Builder is behind:

```jsonc
// Settings (JSON), user scope
"composePreview.earlyFeatures.enabled": true
```

Keep **View → Output → "Compose Preview"** open throughout. Every UI Builder line
there starts with `[ui-builder]`, and the first one names the editor version and
where it came from:

```
[ui-builder] downloading https://github.com/yschimke/compose-ui-builder/releases/download/v3.50.0/…
[ui-builder] editor 3.50.0 from release 3.50.0
```

For errors inside the page, run **Developer: Open Webview Developer Tools** with
the UI Builder tab focused, and look at its Console.

### Sample designs

[`docs/ui-builder-testing/`](ui-builder-testing/) holds three designs:

| File | Catalog | Nodes | Good for |
| --- | --- | --- | --- |
| `state-actions.uid` | Material 3 | 4 | edits, undo, save: small enough to reason about |
| `gmail-tablet.uid` | Material 3 | 164 | a real screen: layers tree depth, preview, performance |
| `home-wear.uid` | Wear M3 | 55 | a second catalog |

They come from compose-ui-builder's fixtures. Do not edit them directly. Make
scratch copies beside them and edit those; the originals stay untouched for
comparison:

```sh
cd docs/ui-builder-testing
for f in *.uid; do cp "$f" "scratch-$f"; done   # untracked; delete when done
```

## Checklist

Each check has an ID, what to do, and what should happen. Take a screenshot where
it says 📸.

### A. Opening

| ID | Do | Expect |
| --- | --- | --- |
| A1 | Open `state-actions.uid` from the Explorer. | It opens in **Compose UI Builder**, not as JSON. On first use a "preparing the editor" progress shows in the status bar while the archive downloads. |
| A2 | Wait for the editor. | A canvas with a Column holding a "Ready" button and a progress bar, and a **Properties** panel on the right. There is **no toolbar across the top of the page and no icon strips down its sides**: those are VS Code's now (section B). 📸 |
| A3 | Time it: from opening the file to the canvas painting, second time (archive cached). | A few seconds. Report the number. |
| A4 | Check the Output channel. | `[ui-builder] editor 3.50.0 from release 3.50.0`, and no `page error` lines. |
| A5 | Close and reopen the file. | Opens again with no second download. |
| A6 | Turn `composePreview.earlyFeatures.enabled` off, then open the file. | A page saying the UI Builder is early access, with **Enable early features** and **Open as text** buttons. Both work. Turn the setting back on. |

### B. VS Code chrome (the editor's toolbar and rails)

With `state-actions.uid` focused:

| ID | Do | Expect |
| --- | --- | --- |
| B1 | Look at the editor title bar (top right of the tab). | Buttons for **Undo**, **Redo**, **Show Components**, **Show/Hide Properties**, **Toggle Generated Code**, and **Open Design as Text**. 📸 |
| B2 | Before any edit, hover Undo and Redo. | Both disabled. |
| B3 | Click **Show Components**. | The components panel opens on the left of the canvas, and the button becomes **Hide Components** (a different icon). Click again: it closes and the button flips back. |
| B4 | Same for **Hide Properties** / **Show Properties**. | The Properties panel closes and opens, and the button flips. |
| B5 | **Toggle Generated Code**. | The generated Kotlin appears; toggle again hides it. |
| B6 | Open the title bar's **"…"** menu. | Theme, Screen, Issues, Comments, History, Layers (in the Editor), Toggle Reference Image, Tidy to the 4dp Grid, Component Packs…, Keyboard Shortcuts, UI Builder Help. Each opens its panel or dialog. **UI Builder Help** opens the getting-started page in your browser. 📸 of the menu. |
| B7 | Open a normal file (any `.md`) in the same editor group. | The UI Builder buttons disappear from the title bar. Switching back brings them back. |

### C. The design is the file

Use `scratch-state-actions.uid`.

| ID | Do | Expect |
| --- | --- | --- |
| C1 | Select the progress indicator on the canvas and press Backspace. | It disappears, the tab shows the **dirty dot**, and **Undo** in the title bar enables. |
| C2 | Click **Undo** in the title bar, then Redo. | The progress indicator comes back, then goes again. |
| C3 | Save (Ctrl/Cmd+S) with the canvas focused. | The dirty dot clears. `git diff --no-index state-actions.uid scratch-state-actions.uid` shows the change. Plain `git diff` does not, because the scratch copy is untracked. The first save may reformat the whole file into the editor's JSON layout; that is expected. |
| C4 | Run **Compose UI Builder: Open Design as Text** (title-bar button). | The JSON opens beside the canvas. |
| C5 | In the JSON, change the button's `"Ready"` text to `"Go"`. | About a quarter of a second after you stop typing, the canvas shows "Go". |
| C6 | Make the JSON invalid (delete a closing brace). | A warning banner over the canvas: "Showing the last valid version: the file is not valid JSON…". The canvas keeps the last good design. |
| C7 | With the JSON still broken, try an edit on the canvas. | The edit is refused with a red banner saying it was not saved. The JSON is **not** overwritten. Fix the brace: the banner clears and the canvas follows the text. |
| C8 | Select all text in the JSON and delete it. | The banner says the file is empty. The canvas keeps the old design and does not write it back. Undo in the text editor restores it. |
| C9 | **File → Revert File** after an unsaved canvas edit. | The canvas returns to the saved version. |
| C10 | Make a canvas edit, then quit VS Code without saving and reopen it. | Hot exit restores the unsaved edit (VS Code's standard behaviour for text documents). |

### D. Design Layers view

Open the **Compose Preview** side bar (its activity-bar icon).

| ID | Do | Expect |
| --- | --- | --- |
| D1 | Focus `scratch-gmail-tablet.uid`. | **Design Layers** shows the design's tree, with the title as its description and slots as separate rows where a node has several. 📸 |
| D2 | Click a row deep in the tree. | That layer is selected on the canvas and Properties shows it. |
| D3 | Click a different element on the canvas. | The tree reveals and selects its row. |
| D4 | Delete a layer on the canvas. | It leaves the tree. |
| D5 | Focus a non-design file. | The tree empties and shows the welcome text with **New Design…**. |

### E. Design Preview view

| ID | Do | Expect |
| --- | --- | --- |
| E1 | Expand **Design Preview** in the Compose Preview side bar with `scratch-gmail-tablet.uid` focused. | The design rendered on its own, labelled "Current · 1280×800dp", with no editor controls. 📸 |
| E2 | Edit on the canvas, for example delete a list row. | The preview follows within about a second. |
| E3 | Switch focus between `scratch-gmail-tablet.uid` and `scratch-home-wear.uid`. | The preview follows the focused design. |

### F. Theme

| ID | Do | Expect |
| --- | --- | --- |
| F1 | With **Dark Modern** active, look at the editor. | Panels use the side-bar grey, the area behind the design is the editor background, and accents are VS Code blue, not purple. 📸 |
| F2 | Switch to **Light Modern** (Preferences: Color Theme) with the editor open. | The editor and Design Preview recolour **without reloading**, and the canvas keeps its selection. 📸 |
| F3 | Try a **High Contrast** theme. | Readable. Report anything unreadable with a screenshot. |

### G. New designs and other catalogs

| ID | Do | Expect |
| --- | --- | --- |
| G1 | **Compose UI Builder: New Design…** → "Wear OS — blank screen", saved as `scratch.uid`. | A new file opens with a round Wear screen, already dirty (the template was written into it). Save works. |
| G2 | Same for "Material 3 — blank screen" and "Wear widget — large". | Each opens its template. |
| G3 | Open `home-wear.uid`. | The Wear design renders (a watch-sized, tall list of device rows). 📸 |
| G4 | Create an empty file `empty.uid` and open it. | A quick pick asks which template to start from. Escape leaves a banner saying the file is empty. |

### H. Local editor builds (optional)

Only if you have a [compose-ui-builder](https://github.com/yschimke/compose-ui-builder)
checkout:

| ID | Do | Expect |
| --- | --- | --- |
| H1 | `./gradlew :ui-builder-web:webArchive` there, then set `composePreview.uiBuilder.webDistPath` to the zip in `ui-builder-web/build/distributions/`. | Open editors and Design Preview reload. The Output channel names the zip as the source. |
| H2 | Clear the setting. | Back to `release 3.50.0`. |

## Known and expected

Report these only if they are worse than described:

- **Catalog thumbnails ignore the theme.** On a light theme the "Supporting pane
  scaffold" tile's label is faint.
- **Slot hint outlines overlap chip labels** on a selected row (dashed boxes
  inside the Gmail filter chips). That is the editor's own drawing.
- **First save reformats the file** into the editor's JSON layout.
- **Two undo stacks.** Ctrl/Cmd+Z inside the canvas is the editor's undo, which
  is fine-grained. Edit → Undo in the menu undoes the text document instead, which
  reloads the canvas. Both leave the file right, but report which one feels wrong.

## Report

Paste this, filled in, into a comment on the pull request or issue that asked for
the test:

```markdown
## UI Builder local test

- VS Code: <version> (<OS>, <GPU / integrated>)
- Extension: <version from the VSIX>, editor: <from the Output channel>
- Time to first paint (A3): <seconds>

| ID | Result | Notes |
| --- | --- | --- |
| A1 | pass / fail / not run | … |
| … | | |

### Failures
For each: steps, what happened, what should have happened, screenshot, and any
`[ui-builder]` Output lines or webview-devtools console errors.

### Screenshots
<the 📸 ones>
```

When something fails, the most useful evidence is, in order:

1. the webview devtools console;
2. the `[ui-builder]` lines in the Output channel;
3. the file's text before and after (`git diff`);
4. a screenshot.
