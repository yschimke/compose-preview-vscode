// Minimal PNG reader: enough to answer "did anything paint?" without adding an
// image dependency to a repository that does not otherwise have one. Chromium
// screenshots are 8-bit RGB/RGBA, non-interlaced, which is the only case here.
import { inflateSync } from "node:zlib";

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

export function decodePng(buffer) {
    let offset = 8; // signature
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            const depth = data[8];
            const colorType = data[9];
            if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
                throw new Error(
                    `unsupported PNG (depth ${depth}, colour type ${colorType})`,
                );
            }
            channels = colorType === 6 ? 4 : 3;
        } else if (type === "IDAT") {
            idat.push(data);
        } else if (type === "IEND") {
            break;
        }
        offset += 12 + length;
    }

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(height * stride);

    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
        for (let x = 0; x < stride; x += 1) {
            const a = x >= channels ? out[x - channels] : 0;
            const b = prior ? prior[x] : 0;
            const c = prior && x >= channels ? prior[x - channels] : 0;
            const value = line[x];
            switch (filter) {
                case 0:
                    out[x] = value;
                    break;
                case 1:
                    out[x] = (value + a) & 0xff;
                    break;
                case 2:
                    out[x] = (value + b) & 0xff;
                    break;
                case 3:
                    out[x] = (value + ((a + b) >> 1)) & 0xff;
                    break;
                case 4:
                    out[x] = (value + paeth(a, b, c)) & 0xff;
                    break;
                default:
                    throw new Error(`unknown PNG filter ${filter} on row ${y}`);
            }
        }
    }

    return { width, height, channels, pixels };
}

/**
 * How much of the image is not the page's background. A Compose canvas that
 * never painted leaves the body's flat white, so "distinct colours" separates
 * "painted something" from "painted nothing" without knowing what the editor
 * looks like.
 */
export function paintStats(png) {
    const { width, height, channels, pixels } = png;
    const colours = new Set();
    let nonWhite = 0;
    for (let i = 0; i < width * height; i += 1) {
        const r = pixels[i * channels];
        const g = pixels[i * channels + 1];
        const b = pixels[i * channels + 2];
        if (r !== 255 || g !== 255 || b !== 255) nonWhite += 1;
        colours.add((r << 16) | (g << 8) | b);
    }
    return {
        distinctColours: colours.size,
        nonWhiteFraction: nonWhite / (width * height),
    };
}
