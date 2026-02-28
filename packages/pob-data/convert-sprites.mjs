/**
 * Converts DDS sprite sheets from PoB TreeData to PNG sprite atlases.
 *
 * The DDS files use DX10 texture arrays: each "sprite" is a separate array
 * slice of size cellW x cellH, with mipmaps. The ddsCoords in tree.json
 * map sprite names to 1-based array indices.
 *
 * We decode each slice's mip-0 (full resolution) and composite them into
 * a single sprite atlas PNG for efficient loading in the browser.
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { decodeBC7 } from "./bc7-decode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TREE_VERSION = "0_4";
const treeDir = join(__dirname, "..", "..", "vendor", "PathOfBuilding-PoE2", "src", "TreeData", TREE_VERSION);
const outDir = join(__dirname, "..", "web", "public", "data", "sprites");
const treeJson = JSON.parse(readFileSync(join(__dirname, "..", "web", "public", "data", "tree.json"), "utf8"));

mkdirSync(outDir, { recursive: true });

// ---- DDS Decoder ----

function parseDdsHeader(buf) {
  if (buf.readUInt32LE(0) !== 0x20534444) throw new Error("Not a DDS file");
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const mipCount = Math.max(1, buf.readUInt32LE(28));
  const pfFlags = buf.readUInt32LE(80);
  const fourCC = buf.toString("ascii", 84, 88);
  const rgbBitCount = buf.readUInt32LE(88);

  let format = "unknown";
  let headerSize = 128;
  let arraySize = 1;
  let dxgiFormat = 0;

  if (fourCC === "DXT1") { format = "BC1"; }
  else if (fourCC === "DXT5") { format = "BC3"; }
  else if (fourCC === "DX10") {
    dxgiFormat = buf.readUInt32LE(128);
    arraySize = buf.readUInt32LE(140);
    headerSize = 148;
    if (dxgiFormat === 71 || dxgiFormat === 72) format = "BC1";
    else if (dxgiFormat === 98 || dxgiFormat === 99) format = "BC7";
    else if (dxgiFormat === 87) format = "BGRA";
    else if (dxgiFormat === 28) format = "RGBA";
  } else if (pfFlags & 0x40) {
    if (rgbBitCount === 32) format = "RGBA";
  }

  return { width, height, format, headerSize, arraySize, mipCount, dxgiFormat, fourCC };
}

function blockSizeBytes(format) {
  return format === "BC1" ? 8 : 16; // BC7, BC3 = 16
}

/** Calculate total bytes for one array slice including all mip levels */
function sliceSizeBytes(w, h, mipCount, format) {
  const bsz = blockSizeBytes(format);
  let total = 0;
  for (let m = 0; m < mipCount; m++) {
    const bw = Math.max(1, Math.ceil(w / 4));
    const bh = Math.max(1, Math.ceil(h / 4));
    total += bw * bh * bsz;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return total;
}

// BC1 block decoder
function decodeBC1Block(data, offset) {
  const c0 = data.readUInt16LE(offset);
  const c1 = data.readUInt16LE(offset + 2);
  const bits = data.readUInt32LE(offset + 4);

  const r0 = ((c0 >> 11) & 0x1f) * 255 / 31;
  const g0 = ((c0 >> 5) & 0x3f) * 255 / 63;
  const b0 = (c0 & 0x1f) * 255 / 31;
  const r1 = ((c1 >> 11) & 0x1f) * 255 / 31;
  const g1 = ((c1 >> 5) & 0x3f) * 255 / 63;
  const b1 = (c1 & 0x1f) * 255 / 31;

  const colors = new Uint8Array(16);
  colors[0] = r0; colors[1] = g0; colors[2] = b0; colors[3] = 255;
  colors[4] = r1; colors[5] = g1; colors[6] = b1; colors[7] = 255;

  if (c0 > c1) {
    colors[8]  = (2*r0 + r1) / 3; colors[9]  = (2*g0 + g1) / 3; colors[10] = (2*b0 + b1) / 3; colors[11] = 255;
    colors[12] = (r0 + 2*r1) / 3; colors[13] = (g0 + 2*g1) / 3; colors[14] = (b0 + 2*b1) / 3; colors[15] = 255;
  } else {
    colors[8]  = (r0 + r1) / 2; colors[9]  = (g0 + g1) / 2; colors[10] = (b0 + b1) / 2; colors[11] = 255;
    colors[12] = 0; colors[13] = 0; colors[14] = 0; colors[15] = 0;
  }

  const pixels = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const idx = (bits >> (i * 2)) & 0x3;
    pixels[i * 4]     = colors[idx * 4];
    pixels[i * 4 + 1] = colors[idx * 4 + 1];
    pixels[i * 4 + 2] = colors[idx * 4 + 2];
    pixels[i * 4 + 3] = colors[idx * 4 + 3];
  }
  return pixels;
}

function decodeBC1Slice(data, offset, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  let off = offset;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const block = decodeBC1Block(data, off);
      off += 8;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px, y = by * 4 + py;
          if (x < width && y < height) {
            const si = (py * 4 + px) * 4;
            const di = (y * width + x) * 4;
            pixels[di] = block[si]; pixels[di+1] = block[si+1];
            pixels[di+2] = block[si+2]; pixels[di+3] = block[si+3];
          }
        }
      }
    }
  }
  return pixels;
}

// Simplified BC7 decoder (mode 6 only, fallback for others)
function decodeSlice(data, offset, width, height, format) {
  switch (format) {
    case "BC1": return decodeBC1Slice(data, offset, width, height);
    case "BC7": return decodeBC7(data, offset, width, height);
    case "RGBA": return Buffer.from(data.subarray(offset, offset + width * height * 4));
    default: throw new Error(`Unsupported format: ${format}`);
  }
}

// ---- Sprite Atlas Generation ----

async function convertSpriteSheet(ddsFilename) {
  const zstPath = join(treeDir, ddsFilename);
  if (!existsSync(zstPath)) return;

  const match = ddsFilename.match(/(\d+)_(\d+)_([A-Za-z0-9]+)\.dds\.zst$/);
  if (!match) return;
  const cellW = parseInt(match[1]);
  const cellH = parseInt(match[2]);

  // Decompress
  const tmpDds = `/tmp/pob_${basename(ddsFilename, ".zst")}`;
  execSync(`zstd -d -f "${zstPath}" -o "${tmpDds}"`, { stdio: "pipe" });
  const ddsData = readFileSync(tmpDds);
  const header = parseDdsHeader(ddsData);

  const sliceBytes = sliceSizeBytes(header.width, header.height, header.mipCount, header.format);
  // mip-0 size only (that's what we extract)
  const bsz = blockSizeBytes(header.format);
  const mip0Bytes = Math.max(1, Math.ceil(header.width / 4)) * Math.max(1, Math.ceil(header.height / 4)) * bsz;

  const coords = treeJson.ddsCoords[ddsFilename] || {};
  const spriteCount = header.arraySize;

  console.log(`  ${ddsFilename}: ${header.width}x${header.height} ${header.format}, ${spriteCount} slices, ${Object.keys(coords).length} named`);

  // Create atlas: arrange sprites in a grid
  const atlasCols = Math.ceil(Math.sqrt(spriteCount));
  const atlasRows = Math.ceil(spriteCount / atlasCols);
  const atlasW = atlasCols * cellW;
  const atlasH = atlasRows * cellH;
  const atlasPixels = Buffer.alloc(atlasW * atlasH * 4);

  for (let i = 0; i < spriteCount; i++) {
    const sliceOffset = header.headerSize + i * sliceBytes;
    let slicePixels;
    try {
      slicePixels = decodeSlice(ddsData, sliceOffset, header.width, header.height, header.format);
    } catch {
      continue;
    }

    const col = i % atlasCols;
    const row = Math.floor(i / atlasCols);

    // Copy slice pixels into atlas
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const si = (y * header.width + x) * 4;
        const dx = col * cellW + x;
        const dy = row * cellH + y;
        const di = (dy * atlasW + dx) * 4;
        atlasPixels[di]     = slicePixels[si];
        atlasPixels[di + 1] = slicePixels[si + 1];
        atlasPixels[di + 2] = slicePixels[si + 2];
        atlasPixels[di + 3] = slicePixels[si + 3];
      }
    }
  }

  const sheetName = ddsFilename.replace(".dds.zst", "");
  const sheetPath = join(outDir, `${sheetName}.png`);
  await sharp(atlasPixels, { raw: { width: atlasW, height: atlasH, channels: 4 } })
    .png()
    .toFile(sheetPath);

  // Save metadata
  const meta = {
    sheet: `${sheetName}.png`,
    cellW, cellH, cols: atlasCols, rows: atlasRows,
    width: atlasW, height: atlasH,
    sprites: {},
  };

  for (const [spriteName, idx] of Object.entries(coords)) {
    const i = idx - 1; // 1-based to 0-based
    const col = i % atlasCols;
    const row = Math.floor(i / atlasCols);
    meta.sprites[spriteName] = { x: col * cellW, y: row * cellH, w: cellW, h: cellH };
  }

  writeFileSync(join(outDir, `${sheetName}.json`), JSON.stringify(meta));
  return meta;
}

async function main() {
  console.log("Converting DDS sprite sheets to PNG atlases...\n");

  const ddsFiles = readdirSync(treeDir).filter(f => f.endsWith(".dds.zst"));
  console.log(`Found ${ddsFiles.length} DDS files\n`);

  const allMeta = {};
  for (const f of ddsFiles) {
    try {
      const meta = await convertSpriteSheet(f);
      if (meta) allMeta[f] = meta;
    } catch (e) {
      console.error(`  ERROR: ${f}: ${e.message}`);
    }
  }

  writeFileSync(join(outDir, "_sprites.json"), JSON.stringify(allMeta, null, 2));
  console.log(`\nDone! ${Object.keys(allMeta).length} sheets converted.`);

  // Copy PNG orbit ring files directly
  const pngFiles = readdirSync(treeDir).filter(f => f.endsWith(".png"));
  for (const f of pngFiles) {
    writeFileSync(join(outDir, f), readFileSync(join(treeDir, f)));
  }
  console.log(`Copied ${pngFiles.length} PNG files.`);
}

main().catch(console.error);
