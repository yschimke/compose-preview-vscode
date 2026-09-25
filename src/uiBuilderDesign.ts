// Reading a UI Builder design (`DesignDocumentV1`, usually a `.uid` file)
// without the editor: enough to pick its catalog, draw its layer tree, and
// offer new-design templates. Pure — no `vscode` import — so it is unit tested
// directly and shared by the Layers view and the `.uid` document symbols.

/** The declarations the editor reads, as the IntelliJ plugin accepts them. */
export const UI_BUILDER_DESIGN_SCHEMAS: readonly string[] = [
    "compose-ui-builder-document/v1",
    "compose-ui-builder-document/v1-candidate",
];

export interface DesignNode {
    id: string;
    componentId: string;
    properties?: Record<string, unknown>;
    slots?: Record<string, string[]>;
}

export interface DesignDocument {
    schema: string;
    id: string;
    title: string;
    catalogPin: { systemId: string };
    roots: string[];
    nodes: Record<string, DesignNode>;
}

export type ParsedDesign =
    | { kind: "empty" }
    | { kind: "design"; design: DesignDocument }
    | { kind: "invalid"; reason: string };

/** What [text] is, as far as the custom editor is concerned. */
export function parseDesign(text: string): ParsedDesign {
    if (text.trim().length === 0) return { kind: "empty" };
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return {
            kind: "invalid",
            reason: `not valid JSON: ${(error as Error).message}`,
        };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { kind: "invalid", reason: "not a JSON object" };
    }
    const design = value as Partial<DesignDocument>;
    if (
        typeof design.schema !== "string" ||
        !UI_BUILDER_DESIGN_SCHEMAS.includes(design.schema)
    ) {
        return {
            kind: "invalid",
            reason: `schema is ${JSON.stringify(design.schema)}, not one of ${UI_BUILDER_DESIGN_SCHEMAS.join(", ")}`,
        };
    }
    if (typeof design.catalogPin?.systemId !== "string") {
        return { kind: "invalid", reason: "catalogPin.systemId is missing" };
    }
    if (!Array.isArray(design.roots) || typeof design.nodes !== "object") {
        return { kind: "invalid", reason: "roots or nodes is missing" };
    }
    return { kind: "design", design: design as DesignDocument };
}

/** One row of the layer tree: a node, or a named slot of a node with several. */
export interface LayerItem {
    kind: "node" | "slot";
    /** Unique within the tree: the node id, or `<nodeId>#<slot>`. */
    key: string;
    nodeId: string;
    label: string;
    description: string;
    children: LayerItem[];
}

/**
 * The design's containment tree, in the shape the editor's own Layers dock
 * draws: a node's children directly under it when it has one slot, and under
 * a row per slot when it has several — so `topBar`, `content` and
 * `snackbarHost` stay distinguishable. A node reached twice (a malformed
 * design) is drawn once.
 */
export function layerTree(design: DesignDocument): LayerItem[] {
    const seen = new Set<string>();
    const build = (nodeId: string): LayerItem | undefined => {
        const node = design.nodes[nodeId];
        if (!node || seen.has(nodeId)) return undefined;
        seen.add(nodeId);
        const slots = Object.entries(node.slots ?? {});
        const children =
            slots.length === 1
                ? childrenOf(slots[0][1])
                : slots.map(([slot, ids]): LayerItem => ({
                      kind: "slot",
                      key: `${nodeId}#${slot}`,
                      nodeId,
                      label: slot,
                      description: ids.length === 0 ? "empty" : "",
                      children: childrenOf(ids),
                  }));
        return {
            kind: "node",
            key: nodeId,
            nodeId,
            label: componentLabel(node.componentId),
            description: nodeDescription(node),
            children,
        };
    };
    const childrenOf = (ids: string[]): LayerItem[] =>
        ids.map(build).filter((item): item is LayerItem => !!item);
    return childrenOf(design.roots);
}

/** `m3/progress-indicator` → `Progress indicator`. */
export function componentLabel(componentId: string): string {
    const last = componentId.split("/").pop() ?? componentId;
    const words = last.replace(/[-_]+/g, " ").trim();
    return words.length === 0
        ? componentId
        : words[0].toUpperCase() + words.slice(1);
}

function nodeDescription(node: DesignNode): string {
    const text = literalText(node.properties?.["text"]);
    return text ? `${node.id} · "${text}"` : node.id;
}

function literalText(property: unknown): string | undefined {
    if (typeof property !== "object" || property === null) return undefined;
    const value = (property as { value?: unknown }).value;
    return typeof value === "string" && value.length > 0
        ? value.length > 40
            ? `${value.slice(0, 39)}…`
            : value
        : undefined;
}

/** A new design's starting point, from compose-ui-builder's own templates. */
export interface DesignTemplate {
    systemId: string;
    templateId: string;
    label: string;
    detail: string;
}

/**
 * The templates `UiBuilderNewDesignSeed` seeds, for the three catalogs the
 * archive packages. The editor builds the document; this only names it.
 */
export const DESIGN_TEMPLATES: readonly DesignTemplate[] = [
    {
        systemId: "m3-catalog",
        templateId: "blank",
        label: "Material 3 — blank screen",
        detail: "A phone-sized Scaffold with nothing in it",
    },
    {
        systemId: "m3-catalog",
        templateId: "jetcaster",
        label: "Material 3 — Jetcaster sample",
        detail: "The Jetcaster Discover screen, to explore the editor with",
    },
    {
        systemId: "wear-m3",
        templateId: "wear-screen",
        label: "Wear OS — blank screen",
        detail: "An empty ScreenScaffold over a TransformingLazyColumn",
    },
    {
        systemId: "wear-m3",
        templateId: "wear-list",
        label: "Wear OS — list",
        detail: "The same scaffold with list rows in it",
    },
    {
        systemId: "remote-m3",
        templateId: "wear-widget-small",
        label: "Wear widget — small",
        detail: "A Remote Compose widget, small container",
    },
    {
        systemId: "remote-m3",
        templateId: "wear-widget-large",
        label: "Wear widget — large",
        detail: "A Remote Compose widget, large container",
    },
];

/** A design id from a file name: `Home Screen.uid` → `home-screen`. */
export function designIdFor(fileName: string): string {
    const base = fileName.replace(/\.[^.]*$/, "");
    const id = base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return id.length > 0 ? id : "design";
}
