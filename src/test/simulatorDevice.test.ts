import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    SimulatorDeviceInfo,
    SimulatorProcessManager,
    SimulatorProfileId,
    buildDevicePickerItems,
    buildSimulatorLaunchArgs,
    formatSelectedDeviceStatus,
    parseAdbDevicesOutput,
    parseSimulatorDeviceEvent,
} from "../simulatorDevice";

describe("simulatorDevice", () => {
    describe("parseSimulatorDeviceEvent", () => {
        it("parses DeviceHost JSON ready events", () => {
            const line = JSON.stringify({
                event: "device",
                serial: "emulator-5554",
                adbPort: 5555,
                consolePort: 5554,
                grpcPort: 8554,
                avd: "Compose_Preview_Phone",
                formFactor: "phone",
            });
            assert.deepStrictEqual(parseSimulatorDeviceEvent(line), {
                serial: "emulator-5554",
                adbPort: 5555,
                consolePort: 5554,
                grpcPort: 8554,
                avdName: "Compose_Preview_Phone",
                formFactor: "phone",
            });
        });

        it("ignores non-JSON lines and non-device events", () => {
            assert.strictEqual(parseSimulatorDeviceEvent(""), null);
            assert.strictEqual(parseSimulatorDeviceEvent("starting..."), null);
            assert.strictEqual(
                parseSimulatorDeviceEvent(JSON.stringify({ event: "ready" })),
                null,
            );
            assert.strictEqual(
                parseSimulatorDeviceEvent(
                    JSON.stringify({ event: "device", serial: "" }),
                ),
                null,
            );
        });
    });

    describe("buildSimulatorLaunchArgs", () => {
        it("builds phone and wear CLI args", () => {
            assert.deepStrictEqual(buildSimulatorLaunchArgs("phone"), [
                "android-simulator",
                "--adb",
                "--control",
                "stdio",
            ]);
            assert.deepStrictEqual(
                buildSimulatorLaunchArgs("wear", { apiLevel: 35 }),
                [
                    "android-simulator",
                    "--adb",
                    "--control",
                    "stdio",
                    "--form-factor",
                    "wear",
                    "--sdk",
                    "35",
                ],
            );
        });
    });

    describe("parseAdbDevicesOutput", () => {
        it("parses online, offline, and emulator rows from adb devices -l", () => {
            const stdout = [
                "* daemon not running; starting now at tcp:5037",
                "* daemon started successfully",
                "List of devices attached",
                "emulator-5554          device product:sdk_gphone64 model:Pixel_8 device:emu64a transport_id:1",
                "R5CR123456A            device usb:1-1 product:panther model:Pixel_7 device:panther transport_id:2",
                "192.168.1.5:5555       offline",
                "",
            ].join("\n");

            assert.deepStrictEqual(parseAdbDevicesOutput(stdout), [
                {
                    serial: "emulator-5554",
                    state: "device",
                    model: "Pixel 8",
                    device: "emu64a",
                    product: "sdk_gphone64",
                },
                {
                    serial: "R5CR123456A",
                    state: "device",
                    model: "Pixel 7",
                    device: "panther",
                    product: "panther",
                },
                {
                    serial: "192.168.1.5:5555",
                    state: "offline",
                    model: null,
                    device: null,
                    product: null,
                },
            ]);
        });
    });

    describe("buildDevicePickerItems", () => {
        it("always exposes Phone and Wear simulators, deduplicates owned ADB serials, and shows Stop when active", () => {
            const running = new Map<SimulatorProfileId, SimulatorDeviceInfo>([
                [
                    "phone",
                    {
                        serial: "emulator-5554",
                        adbPort: 5555,
                        consolePort: 5554,
                        grpcPort: 8554,
                        avdName: "Compose_Preview_Phone",
                        formFactor: "phone",
                    },
                ],
            ]);
            const adbDevices = [
                {
                    serial: "emulator-5554",
                    state: "device",
                    model: "Compose Preview Simulator",
                    device: "emu",
                    product: "sim",
                },
                {
                    serial: "R5CR123456A",
                    state: "device",
                    model: "Pixel 7",
                    device: "panther",
                    product: "panther",
                },
                {
                    serial: "offline-1",
                    state: "offline",
                    model: "Offline Phone",
                    device: null,
                    product: null,
                },
            ];

            const items = buildDevicePickerItems({
                adbDevices,
                runningSimulators: running,
                selectedTarget: { kind: "simulator", profile: "phone" },
            });

            assert.strictEqual(items.length, 4);
            assert.deepStrictEqual(items[0].target, {
                kind: "simulator",
                profile: "phone",
            });
            assert.strictEqual(items[0].picked, true);
            assert.ok(items[0].description.includes("emulator-5554"));

            assert.deepStrictEqual(items[1].target, {
                kind: "simulator",
                profile: "wear",
            });
            assert.ok(items[1].description.includes("starts on demand"));

            assert.deepStrictEqual(items[2].target, {
                kind: "adb",
                serial: "R5CR123456A",
                label: "Pixel 7",
            });

            assert.deepStrictEqual(items[3].target, {
                kind: "stopSimulators",
            });

            const status = formatSelectedDeviceStatus(
                { kind: "simulator", profile: "phone" },
                running,
            );
            assert.ok(
                status.text.includes("Compose Preview Simulator (Phone)"),
            );
            assert.ok(status.tooltip.includes("emulator-5554"));
        });
    });

    describe("SimulatorProcessManager", () => {
        it("starts, reports ready device, cancels in-flight launches, and stops cleanly on stopAll", async function () {
            if (process.platform === "win32") {
                this.skip();
            }
            const dir = fs.mkdtempSync(
                path.join(os.tmpdir(), "compose-preview-sim-"),
            );
            const phoneScript = path.join(dir, "phone-sim.sh");
            const wearSlowScript = path.join(dir, "wear-slow.sh");
            fs.writeFileSync(
                phoneScript,
                [
                    "#!/usr/bin/env bash",
                    "set -euo pipefail",
                    'echo \'{"event":"device","serial":"emulator-5564","adbPort":5565,"consolePort":5564,"grpcPort":8564,"avd":"Sim_Phone","formFactor":"phone"}\'',
                    "cat > /dev/null",
                ].join("\n") + "\n",
                { mode: 0o755 },
            );
            fs.writeFileSync(
                wearSlowScript,
                [
                    "#!/usr/bin/env bash",
                    "set -euo pipefail",
                    "cat > /dev/null",
                ].join("\n") + "\n",
                { mode: 0o755 },
            );

            const manager = new SimulatorProcessManager();
            try {
                const phoneInfo = await manager.start({
                    cliExecutable: phoneScript,
                    profile: "phone",
                    buildArgs: () => [],
                    startupTimeoutMs: 5_000,
                });
                assert.strictEqual(phoneInfo.serial, "emulator-5564");
                assert.strictEqual(
                    manager.findProfileBySerial("emulator-5564"),
                    "phone",
                );

                // Kick off a slow wear launch that stays in-flight until stopAll().
                const wearPromise = manager
                    .start({
                        cliExecutable: wearSlowScript,
                        profile: "wear",
                        buildArgs: () => [],
                        startupTimeoutMs: 10_000,
                    })
                    .then(
                        () => null,
                        (err: Error) => err,
                    );

                // Give spawn a moment to register the in-flight process.
                await new Promise((r) => setTimeout(r, 100));
                assert.strictEqual(manager.isActiveOrStarting("wear"), true);

                await manager.stopAll();
                const wearErr = await wearPromise;
                assert.ok(wearErr instanceof Error);
                assert.strictEqual(manager.runningInfo("phone"), null);
                assert.strictEqual(manager.runningInfo("wear"), null);
                assert.strictEqual(manager.isActiveOrStarting("phone"), false);
                assert.strictEqual(manager.isActiveOrStarting("wear"), false);
            } finally {
                await manager.dispose();
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    });
});
