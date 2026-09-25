// A minimal ZIP reader for the UI Builder web archive.
//
// The extension ships with `vsce package --no-dependencies`, so the host
// cannot lean on an npm unzip library at runtime. The archive is produced by
// Gradle's `Zip` task — stored or deflated entries, no encryption, no ZIP64
// (it is ~20 MB) — which is the small subset read here. Anything outside it is
// refused rather than guessed at.

import * as zlib from "zlib";

export interface ZipEntry {
    name: string;
    data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Whether [name] is safe to join under an extraction root: relative, no
 * backslashes, no `..` segment. An archive entry that fails this is refused,
 * not sanitised — a crafted name is the whole attack.
 */
export function isSafeEntryName(name: string): boolean {
    if (name.length === 0 || name.startsWith("/") || name.includes("\\")) {
        return false;
    }
    if (/^[A-Za-z]:/.test(name)) return false;
    return name.split("/").every((segment) => segment !== "..");
}

/** Every file entry in [zip], decompressed. Directory entries are skipped. */
export function readZip(zip: Buffer): ZipEntry[] {
    const end = findEndOfCentralDirectory(zip);
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries: ZipEntry[] = [];
    for (let index = 0; index < count; index++) {
        if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
            throw new Error(`zip: bad central directory entry ${index}`);
        }
        const flags = zip.readUInt16LE(offset + 8);
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const size = zip.readUInt32LE(offset + 24);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.toString(
            "utf8",
            offset + 46,
            offset + 46 + nameLength,
        );
        offset += 46 + nameLength + extraLength + commentLength;

        if (name.endsWith("/")) continue;
        if (!isSafeEntryName(name)) {
            throw new Error(`zip: refusing unsafe entry name ${name}`);
        }
        if (flags & 0x1) throw new Error(`zip: ${name} is encrypted`);
        if (
            compressedSize === 0xffffffff ||
            size === 0xffffffff ||
            localOffset === 0xffffffff
        ) {
            throw new Error(`zip: ${name} needs ZIP64, which is unsupported`);
        }
        if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
            throw new Error(`zip: bad local header for ${name}`);
        }
        const dataStart =
            localOffset +
            30 +
            zip.readUInt16LE(localOffset + 26) +
            zip.readUInt16LE(localOffset + 28);
        const raw = zip.subarray(dataStart, dataStart + compressedSize);
        let data: Buffer;
        if (method === 0) {
            data = Buffer.from(raw);
        } else if (method === 8) {
            data = zlib.inflateRawSync(raw);
        } else {
            throw new Error(`zip: ${name} uses unsupported method ${method}`);
        }
        if (data.length !== size) {
            throw new Error(
                `zip: ${name} inflated to ${data.length} bytes, expected ${size}`,
            );
        }
        entries.push({ name, data });
    }
    return entries;
}

function findEndOfCentralDirectory(zip: Buffer): number {
    // The record is 22 bytes plus a comment of at most 65535.
    const earliest = Math.max(0, zip.length - 22 - 0xffff);
    for (let offset = zip.length - 22; offset >= earliest; offset--) {
        if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
            return offset;
        }
    }
    throw new Error("zip: no end of central directory; not a zip archive");
}
