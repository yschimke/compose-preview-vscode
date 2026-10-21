// The VS Code host asks a running UI Builder service for the same composed
// capabilities its browser editor uses. Successful reads are cached per catalog
// so designs opened once can be edited without a network connection.

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

export const DEFAULT_CATALOGS_URL =
    "https://ui.coo.ee/api/ui-builder/v1/requests";

export interface CatalogPin {
    systemId: string;
    catalogRevision?: string;
    capabilityDigest?: string;
    nativeRuntimeId?: string;
}

interface CatalogCapability {
    schema: string;
    benchmark: {
        catalogSystemId: string;
        catalogRevision: string;
        nativeRuntimeId: string;
    };
    capabilityDigest?: string;
    components: unknown[];
}

function isCatalog(
    value: unknown,
    systemId: string,
): value is CatalogCapability {
    if (typeof value !== "object" || value === null) return false;
    const catalog = value as Partial<CatalogCapability>;
    return (
        [
            "compose-ui-builder-capabilities/v1",
            "compose-ui-builder-capabilities/v1-candidate",
        ].includes(catalog.schema ?? "") &&
        catalog.benchmark?.catalogSystemId === systemId &&
        Array.isArray(catalog.components)
    );
}

function parseCachedCatalog(
    text: string,
    systemId: string,
): CatalogCapability | undefined {
    try {
        const parsed: unknown = JSON.parse(text);
        return isCatalog(parsed, systemId) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

// The current v1 service stamps this digest on its CatalogReferenceV1, while
// CatalogCapabilityV1 has no digest field. Read a wire field when it gains one.
function reference(catalog: CatalogCapability): Required<CatalogPin> {
    return {
        systemId: catalog.benchmark.catalogSystemId,
        catalogRevision: catalog.benchmark.catalogRevision,
        capabilityDigest: catalog.capabilityDigest ?? "candidate",
        nativeRuntimeId: catalog.benchmark.nativeRuntimeId,
    };
}

function matches(catalog: CatalogCapability, pin: CatalogPin): boolean {
    const offered = reference(catalog);
    return (
        offered.systemId === pin.systemId &&
        (pin.catalogRevision === undefined ||
            offered.catalogRevision === pin.catalogRevision) &&
        (pin.capabilityDigest === undefined ||
            offered.capabilityDigest === pin.capabilityDigest) &&
        (pin.nativeRuntimeId === undefined ||
            offered.nativeRuntimeId === pin.nativeRuntimeId)
    );
}

function versionFile(root: string, pin: Required<CatalogPin>): string {
    const digest = crypto
        .createHash("sha256")
        .update(JSON.stringify(pin))
        .digest("hex");
    return path.join(root, `${pin.systemId}-${digest}.json`);
}

export async function requestCatalogs(
    url: string,
    transport: typeof fetch = fetch,
): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    timeout.unref();
    let response: Response;
    try {
        response = await transport(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                schemaVersion: 1,
                requestId,
                actorId: "anonymous:visitor",
                request: { type: "listCatalogs" },
            }),
        });
    } finally {
        clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const envelope = (await response.json()) as {
        requestId?: string;
        response?: unknown;
    };
    if (envelope.requestId !== requestId) {
        throw new Error("catalog response request ID does not match");
    }
    return envelope.response;
}

export class UiBuilderCatalogs {
    private readonly loaded = new Map<string, Promise<string>>();
    private readonly sourceCacheRoot: string;

    constructor(
        private readonly cacheRoot: string,
        private readonly url: string = DEFAULT_CATALOGS_URL,
        private readonly request: (
            url: string,
        ) => Promise<unknown> = requestCatalogs,
    ) {
        this.sourceCacheRoot = path.join(
            cacheRoot,
            crypto.createHash("sha256").update(url).digest("hex").slice(0, 16),
        );
    }

    load(pin: CatalogPin): Promise<string> {
        const systemId = pin.systemId;
        if (!/^[a-z0-9-]+$/.test(systemId)) {
            return Promise.reject(
                new Error(`invalid catalog id '${systemId}'`),
            );
        }
        const key = JSON.stringify(pin);
        let pending = this.loaded.get(key);
        if (!pending) {
            pending = this.fetchOrCache(pin);
            pending.catch(() => this.loaded.delete(key));
            this.loaded.set(key, pending);
        }
        return pending;
    }

    private async readCache(pin: CatalogPin): Promise<string | undefined> {
        const complete =
            pin.catalogRevision !== undefined &&
            pin.capabilityDigest !== undefined &&
            pin.nativeRuntimeId !== undefined;
        const file = complete
            ? versionFile(this.sourceCacheRoot, pin as Required<CatalogPin>)
            : path.join(this.sourceCacheRoot, `${pin.systemId}-latest.json`);
        const cached = await fs.readFile(file, "utf8").catch(() => undefined);
        const catalog = cached && parseCachedCatalog(cached, pin.systemId);
        return catalog && matches(catalog, pin) ? cached : undefined;
    }

    private async fetchOrCache(pin: CatalogPin): Promise<string> {
        const systemId = pin.systemId;
        let response: unknown;
        try {
            response = await this.request(this.url);
        } catch (error) {
            const cached = await this.readCache(pin);
            if (cached !== undefined) return cached;
            throw new Error(
                `catalog '${systemId}' with the requested pin is unavailable from ${this.url} and has not been cached; open it once online (${String(error)})`,
            );
        }
        const catalogs = (response as { catalogs?: unknown })?.catalogs;
        if (!Array.isArray(catalogs)) {
            throw new Error(`${this.url} returned no catalog list`);
        }
        const offered = catalogs.filter((entry) =>
            isCatalog(entry, systemId),
        ) as CatalogCapability[];
        const catalog = offered.find((entry) => matches(entry, pin));
        if (!catalog) {
            const cached = await this.readCache(pin);
            if (cached !== undefined) return cached;
            if (offered.length === 0) {
                throw new Error(
                    `${this.url} does not serve catalog '${systemId}'`,
                );
            }
            throw new Error(
                `catalog '${systemId}' is pinned to ${JSON.stringify(pin)}, but ${this.url} serves ${offered.map((entry) => JSON.stringify(reference(entry))).join(", ")}; the pinned version is not cached`,
            );
        }
        const text = JSON.stringify(catalog);
        try {
            await fs.mkdir(this.sourceCacheRoot, { recursive: true });
            for (const file of [
                versionFile(this.sourceCacheRoot, reference(catalog)),
                path.join(this.sourceCacheRoot, `${systemId}-latest.json`),
            ]) {
                const staging = `${file}.${process.pid}.tmp`;
                await fs.writeFile(staging, text);
                await fs.rename(staging, file);
            }
        } catch {
            // The live catalog is still usable if global storage cannot be written.
        }
        return text;
    }
}

/** The published-templates route of [systemId], on the same server as [catalogsUrl]. */
export function templatesUrl(catalogsUrl: string, systemId: string): string {
    return new URL(
        `/api/ui-builder/v1/catalogs/${encodeURIComponent(systemId)}/templates`,
        catalogsUrl,
    ).toString();
}

export async function requestTemplates(
    url: string,
    transport: typeof fetch = fetch,
): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    timeout.unref();
    try {
        const response = await transport(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

interface TemplateDocuments {
    schemaVersion: number;
    catalogPin: CatalogPin;
    templates: Record<string, unknown>;
}

function parseTemplates(
    text: string,
    pin: Required<CatalogPin>,
): TemplateDocuments | undefined {
    try {
        const parsed = JSON.parse(text) as Partial<TemplateDocuments>;
        const published = parsed.catalogPin;
        return parsed.schemaVersion === 1 &&
            typeof parsed.templates === "object" &&
            parsed.templates !== null &&
            published?.systemId === pin.systemId &&
            published.catalogRevision === pin.catalogRevision &&
            published.capabilityDigest === pin.capabilityDigest &&
            published.nativeRuntimeId === pin.nativeRuntimeId
            ? (parsed as TemplateDocuments)
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The template documents a catalog publishes (`CatalogTemplateDocumentsV1`), which the editor seeds
 * a new design from, as the web host's New design form does. Cached per exact catalog pin so a
 * catalog reopened offline still seeds from the set it was published with.
 */
export class UiBuilderTemplates {
    private readonly sourceCacheRoot: string;

    constructor(
        cacheRoot: string,
        private readonly catalogsUrl: string = DEFAULT_CATALOGS_URL,
        private readonly request: (
            url: string,
        ) => Promise<string> = requestTemplates,
    ) {
        this.sourceCacheRoot = path.join(
            cacheRoot,
            crypto
                .createHash("sha256")
                .update(catalogsUrl)
                .digest("hex")
                .slice(0, 16),
        );
    }

    /**
     * The published set for the catalog [capabilities] describes, when it is for exactly that
     * catalog and holds [templateId]; otherwise undefined, and the editor falls back to its
     * built-in seed. Never throws: a missing set only changes where the seed comes from.
     */
    async forTemplate(
        capabilities: string,
        templateId: string,
    ): Promise<string | undefined> {
        let catalog: CatalogCapability;
        try {
            catalog = JSON.parse(capabilities) as CatalogCapability;
        } catch {
            return undefined;
        }
        const systemId = catalog.benchmark?.catalogSystemId ?? "";
        if (!isCatalog(catalog, systemId) || !/^[a-z0-9-]+$/.test(systemId)) {
            return undefined;
        }
        const pin = reference(catalog);
        const file = `${versionFile(this.sourceCacheRoot, pin).slice(0, -".json".length)}.templates.json`;
        let text = await this.request(templatesUrl(this.catalogsUrl, systemId))
            .then((fetched) =>
                parseTemplates(fetched, pin) ? fetched : undefined,
            )
            .catch(() => undefined);
        if (text !== undefined) {
            try {
                await fs.mkdir(this.sourceCacheRoot, { recursive: true });
                const staging = `${file}.${process.pid}.tmp`;
                await fs.writeFile(staging, text);
                await fs.rename(staging, file);
            } catch {
                // The live set is still usable if global storage cannot be written.
            }
        } else {
            text = await fs.readFile(file, "utf8").catch(() => undefined);
        }
        const templates =
            text === undefined ? undefined : parseTemplates(text, pin);
        return templates && templateId in templates.templates
            ? text
            : undefined;
    }
}
