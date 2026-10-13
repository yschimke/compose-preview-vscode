// The VS Code host asks a running UI Builder service for the same composed
// capabilities its browser editor uses. Successful reads are cached per catalog
// so designs opened once can be edited without a network connection.

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";

export const DEFAULT_CATALOGS_URL =
    "https://ui.coo.ee/api/ui-builder/v1/requests";

interface CatalogCapability {
    schema: string;
    benchmark: { catalogSystemId: string };
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

function isCachedCatalog(text: string, systemId: string): boolean {
    try {
        return isCatalog(JSON.parse(text), systemId);
    } catch {
        return false;
    }
}

export async function requestCatalogs(
    url: string,
    transport: typeof fetch = fetch,
): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const response = await transport(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
            schemaVersion: 1,
            requestId,
            actorId: "anonymous:visitor",
            request: { type: "listCatalogs" },
        }),
    });
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

    load(systemId: string): Promise<string> {
        if (!/^[a-z0-9-]+$/.test(systemId)) {
            return Promise.reject(
                new Error(`invalid catalog id '${systemId}'`),
            );
        }
        let pending = this.loaded.get(systemId);
        if (!pending) {
            pending = this.fetchOrCache(systemId);
            pending.catch(() => this.loaded.delete(systemId));
            this.loaded.set(systemId, pending);
        }
        return pending;
    }

    private async fetchOrCache(systemId: string): Promise<string> {
        const file = path.join(this.sourceCacheRoot, `${systemId}.json`);
        let response: unknown;
        try {
            response = await this.request(this.url);
        } catch (error) {
            const cached = await fs
                .readFile(file, "utf8")
                .catch(() => undefined);
            if (cached !== undefined && isCachedCatalog(cached, systemId)) {
                return cached;
            }
            throw new Error(
                `catalog '${systemId}' is unavailable from ${this.url} and has not been cached; open it once online (${String(error)})`,
            );
        }
        const catalogs = (response as { catalogs?: unknown })?.catalogs;
        if (!Array.isArray(catalogs)) {
            throw new Error(`${this.url} returned no catalog list`);
        }
        const catalog = catalogs.find((entry) => isCatalog(entry, systemId));
        if (!catalog) {
            throw new Error(`${this.url} does not serve catalog '${systemId}'`);
        }
        const text = JSON.stringify(catalog);
        try {
            await fs.mkdir(this.sourceCacheRoot, { recursive: true });
            const staging = `${file}.${process.pid}.tmp`;
            await fs.writeFile(staging, text);
            await fs.rename(staging, file);
        } catch {
            // The live catalog is still usable if global storage cannot be written.
        }
        return text;
    }
}
