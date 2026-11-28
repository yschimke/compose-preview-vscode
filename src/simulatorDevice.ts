import { ChildProcess, spawn } from "child_process";
import * as readline from "readline";

/**
 * Pure-Node (vscode-free) simulator process lifecycle and ADB device picker
 * helpers for VS Code. Mirrors `compose-preview-ide`'s `DeviceProvisionerPlugin`
 * contract (`compose-preview android-simulator --adb --control stdio`).
 */

export type SimulatorProfileId = "phone" | "wear";

export interface SimulatorProfile {
    readonly id: SimulatorProfileId;
    readonly displayName: string;
    readonly formFactorArg?: string;
}

export const SIMULATOR_PROFILES: ReadonlyArray<SimulatorProfile> = [
    {
        id: "phone",
        displayName: "Compose Preview Simulator (Phone)",
    },
    {
        id: "wear",
        displayName: "Compose Preview Simulator (Wear)",
        formFactorArg: "wear",
    },
];

export function getSimulatorProfile(id: SimulatorProfileId): SimulatorProfile {
    return SIMULATOR_PROFILES.find((p) => p.id === id) ?? SIMULATOR_PROFILES[0];
}

/**
 * Metadata emitted by `compose-preview android-simulator --adb --control stdio`
 * once the virtual ADB/console/gRPC ports are listening and registered with ADB.
 */
export interface SimulatorDeviceInfo {
    readonly serial: string;
    readonly adbPort: number;
    readonly consolePort: number;
    readonly grpcPort: number | null;
    readonly avdName: string | null;
    readonly formFactor: string;
}

export interface AdbDevice {
    readonly serial: string;
    readonly state: string;
    readonly model: string | null;
    readonly device: string | null;
    readonly product: string | null;
}

export type SelectedDeviceTarget =
    | { kind: "simulator"; profile: SimulatorProfileId }
    | { kind: "adb"; serial: string; label: string };

export interface DevicePickerEntry {
    readonly label: string;
    readonly description: string;
    readonly detail?: string;
    readonly target: SelectedDeviceTarget | { kind: "stopSimulators" };
    readonly picked: boolean;
}

/**
 * Parses one JSON stdout line emitted by `DeviceHost`
 * (`{"event":"device","serial":"emulator-5554",...}`).
 */
export function parseSimulatorDeviceEvent(
    line: string,
): SimulatorDeviceInfo | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"device"')) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") {
        return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.event !== "device") {
        return null;
    }
    const serial =
        typeof obj.serial === "string" && obj.serial.trim().length > 0
            ? obj.serial.trim()
            : null;
    const adbPort =
        typeof obj.adbPort === "number" && Number.isInteger(obj.adbPort)
            ? obj.adbPort
            : null;
    if (!serial || adbPort === null) {
        return null;
    }
    const consolePort =
        typeof obj.consolePort === "number" && Number.isInteger(obj.consolePort)
            ? obj.consolePort
            : adbPort - 1;
    const grpcPort =
        typeof obj.grpcPort === "number" && Number.isInteger(obj.grpcPort)
            ? obj.grpcPort
            : null;
    const avdName =
        typeof obj.avd === "string" && obj.avd.trim().length > 0
            ? obj.avd.trim()
            : null;
    const formFactor =
        typeof obj.formFactor === "string" && obj.formFactor.trim().length > 0
            ? obj.formFactor.trim()
            : "phone";
    return {
        serial,
        adbPort,
        consolePort,
        grpcPort,
        avdName,
        formFactor,
    };
}

/** Builds the CLI argument vector for launching [profile] as an ADB device. */
export function buildSimulatorLaunchArgs(
    profile: SimulatorProfileId,
    opts?: { apiLevel?: number },
): string[] {
    const spec = getSimulatorProfile(profile);
    const args = ["android-simulator", "--adb", "--control", "stdio"];
    if (spec.formFactorArg) {
        args.push("--form-factor", spec.formFactorArg);
    }
    if (opts?.apiLevel !== undefined) {
        args.push("--sdk", String(opts.apiLevel));
    }
    return args;
}

/**
 * Parses `adb devices -l` output into structured entries. Ignores the header
 * line, daemon startup banners, and blank lines.
 */
export function parseAdbDevicesOutput(stdout: string): AdbDevice[] {
    const out: AdbDevice[] = [];
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (
            !line ||
            line.startsWith("List of devices") ||
            line.startsWith("*")
        ) {
            continue;
        }
        const tokens = line.split(/\s+/);
        if (tokens.length < 2) {
            continue;
        }
        const [serial, state, ...rest] = tokens;
        let model: string | null = null;
        let device: string | null = null;
        let product: string | null = null;
        for (const token of rest) {
            const eq = token.indexOf(":");
            if (eq <= 0) continue;
            const key = token.slice(0, eq);
            const value = token.slice(eq + 1);
            if (!value) continue;
            if (key === "model") model = value.replace(/_/g, " ");
            else if (key === "device") device = value;
            else if (key === "product") product = value;
        }
        out.push({ serial, state, model, device, product });
    }
    return out;
}

export function formatAdbDeviceLabel(device: AdbDevice): string {
    return device.model || device.device || device.serial;
}

export function formatSelectedDeviceStatus(
    selected: SelectedDeviceTarget | null,
    runningSimulators: ReadonlyMap<SimulatorProfileId, SimulatorDeviceInfo>,
): { text: string; tooltip: string } {
    if (!selected) {
        return {
            text: "$(device-mobile) Select Device",
            tooltip:
                "Compose Preview: choose a physical Android device, emulator, or on-demand Compose Preview Simulator",
        };
    }
    if (selected.kind === "simulator") {
        const spec = getSimulatorProfile(selected.profile);
        const running = runningSimulators.get(selected.profile);
        const suffix = running ? ` (${running.serial})` : "";
        return {
            text: `$(device-mobile) ${spec.displayName}`,
            tooltip: running
                ? `${spec.displayName} running on ${running.serial} — click to switch or stop`
                : `${spec.displayName} (starts on demand when launching) — click to switch`,
        };
    }
    return {
        text: `$(device-mobile) ${selected.label}`,
        tooltip: `Compose Preview target device: ${selected.label} (${selected.serial}) — click to switch`,
    };
}

/**
 * Builds the QuickPick items combining online ADB devices with on-demand
 * Compose Preview Simulator entries (Phone & Wear) and a Stop item whenever
 * at least one simulator is active or starting.
 */
export function buildDevicePickerItems(opts: {
    adbDevices: ReadonlyArray<AdbDevice>;
    runningSimulators: ReadonlyMap<SimulatorProfileId, SimulatorDeviceInfo>;
    startingProfiles?: ReadonlySet<SimulatorProfileId>;
    selectedTarget: SelectedDeviceTarget | null;
}): DevicePickerEntry[] {
    const items: DevicePickerEntry[] = [];
    const starting = opts.startingProfiles ?? new Set<SimulatorProfileId>();
    const ownedSerials = new Map<string, SimulatorProfileId>();
    for (const [profile, info] of opts.runningSimulators.entries()) {
        ownedSerials.set(info.serial, profile);
    }

    // 1. Compose Preview Simulator virtual targets (always selectable, before or after launch).
    for (const spec of SIMULATOR_PROFILES) {
        const running = opts.runningSimulators.get(spec.id);
        const isStarting = starting.has(spec.id);
        const picked =
            opts.selectedTarget?.kind === "simulator" &&
            opts.selectedTarget.profile === spec.id;
        items.push({
            label: `$(vm) ${spec.displayName}`,
            description: running
                ? `Running (${running.serial})`
                : isStarting
                  ? "Starting…"
                  : "Virtual — starts on demand",
            detail: running
                ? `ADB port ${running.adbPort}${running.grpcPort ? ` · gRPC ${running.grpcPort}` : ""}`
                : "Launches `compose-preview android-simulator --adb` automatically on launch",
            target: { kind: "simulator", profile: spec.id },
            picked,
        });
    }

    // 2. Other connected ADB devices / regular AVD emulators (excluding our own simulator serials).
    for (const device of opts.adbDevices) {
        if (ownedSerials.has(device.serial)) continue;
        if (device.state !== "device") continue;
        const friendly = formatAdbDeviceLabel(device);
        const picked =
            opts.selectedTarget?.kind === "adb" &&
            opts.selectedTarget.serial === device.serial;
        items.push({
            label: `$(device-mobile) ${friendly}`,
            description: device.serial,
            detail: device.product
                ? `ADB device (${device.product})`
                : "ADB device",
            target: { kind: "adb", serial: device.serial, label: friendly },
            picked,
        });
    }

    // 3. Stop action when any simulator is running or starting.
    if (opts.runningSimulators.size > 0 || starting.size > 0) {
        items.push({
            label: "$(debug-stop) Stop Compose Preview Simulators",
            description: "Shut down running simulator ADB process(es)",
            target: { kind: "stopSimulators" },
            picked: false,
        });
    }

    return items;
}

interface RunningEntry {
    readonly process: ChildProcess;
    readonly info: SimulatorDeviceInfo;
    stopped: boolean;
}

export interface SimulatorStartOptions {
    readonly cliExecutable: string;
    readonly profile: SimulatorProfileId;
    readonly cwd?: string;
    readonly apiLevel?: number;
    readonly startupTimeoutMs?: number;
    readonly buildArgs?: (profile: SimulatorProfileId) => string[];
    readonly onLog?: (line: string) => void;
}

/**
 * Owns child `compose-preview android-simulator --adb --control stdio`
 * processes spawned by the VS Code extension, coordinating in-flight launches
 * with stop / stopAll / deactivation so no orphan simulators are left behind.
 */
export class SimulatorProcessManager {
    private readonly running = new Map<SimulatorProfileId, RunningEntry>();
    private readonly inFlight = new Map<
        SimulatorProfileId,
        Promise<SimulatorDeviceInfo>
    >();
    private readonly inFlightProcesses = new Map<
        SimulatorProfileId,
        ChildProcess
    >();
    private readonly stopEpochs = new Map<SimulatorProfileId, number>();
    private readonly listeners = new Set<() => void>();
    private disposed = false;

    onDidChange(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    runningInfo(profile: SimulatorProfileId): SimulatorDeviceInfo | null {
        const entry = this.running.get(profile);
        if (!entry) return null;
        if (entry.process.exitCode !== null || entry.process.killed) {
            this.running.delete(profile);
            return null;
        }
        return entry.info;
    }

    runningSnapshot(): Map<SimulatorProfileId, SimulatorDeviceInfo> {
        const out = new Map<SimulatorProfileId, SimulatorDeviceInfo>();
        for (const spec of SIMULATOR_PROFILES) {
            const info = this.runningInfo(spec.id);
            if (info) out.set(spec.id, info);
        }
        return out;
    }

    startingProfiles(): Set<SimulatorProfileId> {
        return new Set(this.inFlight.keys());
    }

    isActiveOrStarting(profile: SimulatorProfileId): boolean {
        return this.runningInfo(profile) !== null || this.inFlight.has(profile);
    }

    findProfileBySerial(serial: string): SimulatorProfileId | null {
        for (const spec of SIMULATOR_PROFILES) {
            const info = this.runningInfo(spec.id);
            if (info && info.serial === serial) return spec.id;
        }
        return null;
    }

    async start(opts: SimulatorStartOptions): Promise<SimulatorDeviceInfo> {
        if (this.disposed) {
            throw new Error(
                "Compose Preview Simulator manager is shutting down.",
            );
        }
        const existing = this.runningInfo(opts.profile);
        if (existing) {
            return existing;
        }
        const pending = this.inFlight.get(opts.profile);
        if (pending) {
            return pending;
        }

        const epoch = this.stopEpochs.get(opts.profile) ?? 0;
        const launchPromise = this.launchInternal(opts, epoch);
        this.inFlight.set(opts.profile, launchPromise);
        this.notify();
        try {
            return await launchPromise;
        } finally {
            if (this.inFlight.get(opts.profile) === launchPromise) {
                this.inFlight.delete(opts.profile);
            }
            this.notify();
        }
    }

    async stop(profile: SimulatorProfileId): Promise<void> {
        this.stopEpochs.set(profile, (this.stopEpochs.get(profile) ?? 0) + 1);
        const pendingProc = this.inFlightProcesses.get(profile);
        if (pendingProc) {
            this.inFlightProcesses.delete(profile);
            await terminateProcess(pendingProc);
        }
        const entry = this.running.get(profile);
        if (entry) {
            this.running.delete(profile);
            entry.stopped = true;
            await terminateProcess(entry.process);
        }
        this.notify();
    }

    async stopAll(): Promise<void> {
        const stops: Array<Promise<void>> = [];
        for (const spec of SIMULATOR_PROFILES) {
            stops.push(this.stop(spec.id));
        }
        await Promise.all(stops);
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.stopAll();
    }

    private launchInternal(
        opts: SimulatorStartOptions,
        epoch: number,
    ): Promise<SimulatorDeviceInfo> {
        const args = opts.buildArgs
            ? opts.buildArgs(opts.profile)
            : buildSimulatorLaunchArgs(opts.profile, {
                  apiLevel: opts.apiLevel,
              });
        const timeoutMs = opts.startupTimeoutMs ?? 90_000;

        return new Promise<SimulatorDeviceInfo>((resolve, reject) => {
            const proc = spawn(opts.cliExecutable, args, {
                cwd: opts.cwd,
                stdio: ["pipe", "pipe", "pipe"],
            });
            this.inFlightProcesses.set(opts.profile, proc);

            let settled = false;
            const recentStderr: string[] = [];
            let entryRef: RunningEntry | null = null;

            const fail = (err: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (this.inFlightProcesses.get(opts.profile) === proc) {
                    this.inFlightProcesses.delete(opts.profile);
                }
                void terminateProcess(proc);
                reject(err);
            };

            const timer = setTimeout(() => {
                fail(
                    new Error(
                        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for Compose Preview Simulator (${opts.profile}) ADB device.`,
                    ),
                );
            }, timeoutMs);

            const checkCancelled = () =>
                this.disposed ||
                (this.stopEpochs.get(opts.profile) ?? 0) !== epoch;

            if (checkCancelled()) {
                fail(
                    new Error(
                        `Compose Preview Simulator (${opts.profile}) was stopped while starting.`,
                    ),
                );
                return;
            }

            if (proc.stderr) {
                const errRl = readline.createInterface({ input: proc.stderr });
                errRl.on("line", (line) => {
                    if (recentStderr.length >= 40) recentStderr.shift();
                    recentStderr.push(line);
                    opts.onLog?.(line);
                });
            }

            if (proc.stdout) {
                const outRl = readline.createInterface({ input: proc.stdout });
                outRl.on("line", (line) => {
                    opts.onLog?.(line);
                    if (settled) return;
                    const info = parseSimulatorDeviceEvent(line);
                    if (!info) return;
                    if (checkCancelled()) {
                        fail(
                            new Error(
                                `Compose Preview Simulator (${opts.profile}) was stopped while starting.`,
                            ),
                        );
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    if (this.inFlightProcesses.get(opts.profile) === proc) {
                        this.inFlightProcesses.delete(opts.profile);
                    }
                    const entry: RunningEntry = {
                        process: proc,
                        info,
                        stopped: false,
                    };
                    entryRef = entry;
                    const prev = this.running.get(opts.profile);
                    this.running.set(opts.profile, entry);
                    if (prev && prev !== entry) {
                        prev.stopped = true;
                        void terminateProcess(prev.process);
                    }
                    this.notify();
                    resolve(info);
                });
            }

            proc.on("error", (err) => {
                fail(
                    new Error(
                        `Failed to launch ${opts.cliExecutable}: ${err.message}`,
                    ),
                );
            });

            proc.on("close", (code) => {
                if (this.inFlightProcesses.get(opts.profile) === proc) {
                    this.inFlightProcesses.delete(opts.profile);
                }
                if (entryRef && this.running.get(opts.profile) === entryRef) {
                    this.running.delete(opts.profile);
                    this.notify();
                }
                if (!settled) {
                    const tail = recentStderr.slice(-10).join("\n");
                    fail(
                        new Error(
                            `compose-preview android-simulator exited (${code ?? -1}) before announcing an ADB device.` +
                                (tail ? `\n${tail}` : ""),
                        ),
                    );
                }
            });
        });
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                /* ignore listener errors */
            }
        }
    }
}

function terminateProcess(proc: ChildProcess): Promise<void> {
    if (proc.exitCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(termTimer);
            clearTimeout(killTimer);
            resolve();
        };
        proc.once("close", finish);
        try {
            proc.stdin?.end();
        } catch {
            /* stdin already closed */
        }
        const termTimer = setTimeout(() => {
            if (proc.exitCode === null) {
                try {
                    proc.kill("SIGTERM");
                } catch {
                    /* ignore */
                }
            }
        }, 2_000);
        const killTimer = setTimeout(() => {
            if (proc.exitCode === null) {
                try {
                    proc.kill("SIGKILL");
                } catch {
                    /* ignore */
                }
            }
            finish();
        }, 4_000);
    });
}
