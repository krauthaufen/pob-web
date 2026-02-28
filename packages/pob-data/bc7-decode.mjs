/**
 * BC7 (BPTC) block decoder.
 * Reference: https://registry.khronos.org/OpenGL/extensions/ARB/ARB_texture_compression_bptc.txt
 *
 * BC7 has 8 modes (0-7), each with different partition counts,
 * endpoint precision, and index precision.
 */

// Mode table: [numSubsets, partBits, rotBits, idxSelBit, colorBits, alphaBits, pBits, idxBits, idx2Bits]
const MODES = [
  //   NS  PB  RB IS  CB  AB  PB  IB I2B
  [3,  4,  0, 0, 4,  0,  6, 3,  0], // mode 0
  [2,  6,  0, 0, 6,  0,  2, 3,  0], // mode 1
  [3,  6,  0, 0, 5,  0,  6, 2,  0], // mode 2
  [2,  6,  0, 0, 7,  0,  4, 2,  0], // mode 3
  [1,  0,  2, 1, 5,  6,  0, 2,  3], // mode 4
  [1,  0,  2, 0, 7,  8,  0, 2,  2], // mode 5
  [1,  0,  0, 0, 7,  7,  2, 4,  0], // mode 6
  [2,  6,  0, 0, 5,  5,  4, 2,  0], // mode 7
];

// Partition tables (2 subsets, 64 entries)
const PART2 = [
  0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1, 0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,1,
  0,1,1,1,0,1,1,1,0,0,0,1,0,0,1,1, 0,0,1,1,0,0,1,1,0,0,1,1,0,1,1,1,
  0,0,0,0,0,0,0,1,0,0,0,1,0,0,1,1, 0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1,
  0,0,0,1,0,0,0,1,0,0,1,1,0,1,1,1, 0,0,1,1,0,0,1,1,0,1,1,1,0,1,1,1,
];

// Partition tables (3 subsets, 64 entries)
const PART3 = [
  0,0,1,1,0,0,1,1,0,2,2,1,2,2,2,2, 0,0,0,1,0,0,1,1,2,2,1,1,2,2,2,1,
  0,0,0,0,2,0,0,1,2,2,1,1,2,2,1,1, 0,2,2,2,0,0,2,2,0,0,1,1,0,1,1,2,
  0,0,0,0,0,0,0,0,1,1,2,2,1,1,2,2, 0,0,1,1,0,0,1,1,0,0,2,2,0,0,2,2,
  0,0,2,2,0,0,2,2,1,1,1,1,1,1,1,1, 0,0,1,1,0,0,1,1,2,2,1,1,2,2,1,1,
];

// Anchor indices for partition subsets
const ANCHOR2_0 = [ // anchor for subset 1 in 2-subset mode
  15,15,15,15,15,15,15,15, 15,15,15,15,15,15,15,15,
  15, 2, 8, 2, 2, 8, 8,15, 2, 8, 2, 2, 8, 8, 2, 2,
  15,15, 6, 8, 2, 8,15,15, 2, 8, 2, 2, 2,15,15, 6,
   6, 2, 6, 8,15,15, 2, 2, 15,15,15,15,15, 2, 2,15,
];

const ANCHOR3_1 = [ // anchor for subset 1 in 3-subset mode
   3, 3,15,15, 8, 3,15,15, 8, 8, 6, 6, 6, 5, 3, 3,
   3, 3, 8,15, 3, 3, 6,10, 5, 8, 8, 6, 8, 5,15,15,
   8,15, 3, 5, 6,10, 8,15, 15, 3,15, 5,15,15,15,15,
   3,15, 5, 5, 5, 8, 5,10, 5,10, 8,13,15,12, 3, 3,
];

const ANCHOR3_2 = [ // anchor for subset 2 in 3-subset mode
  15, 8, 8, 3,15,15, 3, 8, 15,15,15,15,15,15,15, 8,
  15, 8,15, 3,15, 8,15, 8, 3,15, 6,10,15,15,10, 8,
  15, 3,15,10,10, 8, 9,10, 6,15, 8,15, 3, 6, 6, 8,
  15, 3,15,15,15,15,15,15, 15,15,15,15, 3,15,15, 8,
];

// Interpolation weights
const WEIGHTS2 = [0, 21, 43, 64];
const WEIGHTS3 = [0, 9, 18, 27, 37, 46, 55, 64];
const WEIGHTS4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

function getPartition(numSubsets, partIdx, pixelIdx) {
  if (numSubsets === 1) return 0;
  if (numSubsets === 2) return (PART2[partIdx * 16 + pixelIdx] !== undefined) ? PART2[partIdx * 16 + pixelIdx] : 0;
  return (PART3[partIdx * 16 + pixelIdx] !== undefined) ? PART3[partIdx * 16 + pixelIdx] : 0;
}

export function decodeBC7Block(data, offset) {
  const pixels = new Uint8Array(64);

  // Read 128 bits
  let lo = BigInt(data[offset]) | (BigInt(data[offset+1]) << 8n) |
           (BigInt(data[offset+2]) << 16n) | (BigInt(data[offset+3]) << 24n) |
           (BigInt(data[offset+4]) << 32n) | (BigInt(data[offset+5]) << 40n) |
           (BigInt(data[offset+6]) << 48n) | (BigInt(data[offset+7]) << 56n);
  let hi = BigInt(data[offset+8]) | (BigInt(data[offset+9]) << 8n) |
           (BigInt(data[offset+10]) << 16n) | (BigInt(data[offset+11]) << 24n) |
           (BigInt(data[offset+12]) << 32n) | (BigInt(data[offset+13]) << 40n) |
           (BigInt(data[offset+14]) << 48n) | (BigInt(data[offset+15]) << 56n);

  // Full 128-bit value (bit 0 = LSB of first byte)
  const bits128 = lo | (hi << 64n);
  let pos = 0;

  function read(n) {
    let val = 0n;
    for (let i = 0; i < n; i++) {
      val |= ((bits128 >> BigInt(pos + i)) & 1n) << BigInt(i);
    }
    pos += n;
    return Number(val);
  }

  // Determine mode
  let mode = -1;
  for (let i = 0; i < 8; i++) {
    if (data[offset] & (1 << i)) { mode = i; break; }
  }
  if (mode < 0) {
    // All zeros = reserved, output black
    for (let i = 0; i < 64; i++) pixels[i] = 0;
    return pixels;
  }

  pos = mode + 1; // skip mode bits

  const M = MODES[mode];
  const [numSubsets, partBits, rotBits, idxSelBit, colorBits, alphaBits, pBitCount, idxBits, idx2Bits] = M;

  const partition = read(partBits);
  const rotation = read(rotBits);
  const idxSel = read(idxSelBit);

  // Read endpoints: [subset][endpoint(0/1)][channel(rgba)]
  const ep = Array.from({length: numSubsets}, () => [[0,0,0,255],[0,0,0,255]]);

  // Color channels
  for (let ch = 0; ch < 3; ch++) {
    for (let s = 0; s < numSubsets; s++) {
      ep[s][0][ch] = read(colorBits);
      ep[s][1][ch] = read(colorBits);
    }
  }

  // Alpha channel
  if (alphaBits > 0) {
    for (let s = 0; s < numSubsets; s++) {
      ep[s][0][3] = read(alphaBits);
      ep[s][1][3] = read(alphaBits);
    }
  }

  // P-bits
  if (pBitCount > 0) {
    const sharedP = (mode === 1); // mode 1 shares p-bits per subset
    if (sharedP) {
      for (let s = 0; s < numSubsets; s++) {
        const p = read(1);
        for (let e = 0; e < 2; e++) {
          for (let ch = 0; ch < 4; ch++) {
            if (ch < 3 || alphaBits > 0) {
              ep[s][e][ch] = (ep[s][e][ch] << 1) | p;
            }
          }
        }
      }
    } else {
      for (let s = 0; s < numSubsets; s++) {
        for (let e = 0; e < 2; e++) {
          const p = read(1);
          for (let ch = 0; ch < 4; ch++) {
            if (ch < 3 || alphaBits > 0) {
              ep[s][e][ch] = (ep[s][e][ch] << 1) | p;
            }
          }
        }
      }
    }
  }

  // Extend endpoints to 8 bits
  for (let s = 0; s < numSubsets; s++) {
    for (let e = 0; e < 2; e++) {
      for (let ch = 0; ch < 3; ch++) {
        const prec = colorBits + (pBitCount > 0 ? 1 : 0);
        ep[s][e][ch] = (ep[s][e][ch] << (8 - prec)) | (ep[s][e][ch] >> (2 * prec - 8));
      }
      if (alphaBits > 0) {
        const prec = alphaBits + (pBitCount > 0 ? 1 : 0);
        ep[s][e][3] = (ep[s][e][3] << (8 - prec)) | (ep[s][e][3] >> (2 * prec - 8));
      } else {
        ep[s][e][3] = 255;
      }
    }
  }

  // Read primary indices
  const ib = idxBits;
  const weights1 = ib === 2 ? WEIGHTS2 : ib === 3 ? WEIGHTS3 : WEIGHTS4;
  const primaryIdx = new Uint8Array(16);

  // Determine anchor pixels (they have one fewer index bit)
  const anchors = new Set([0]); // pixel 0 is always anchor for subset 0
  if (numSubsets >= 2) anchors.add(ANCHOR2_0[partition]);
  if (numSubsets >= 3) {
    anchors.add(ANCHOR3_1[partition]);
    anchors.add(ANCHOR3_2[partition]);
  }

  for (let i = 0; i < 16; i++) {
    primaryIdx[i] = read(anchors.has(i) ? ib - 1 : ib);
  }

  // Read secondary indices (modes 4, 5)
  const ib2 = idx2Bits;
  const secondaryIdx = new Uint8Array(16);
  if (ib2 > 0) {
    const weights2 = ib2 === 2 ? WEIGHTS2 : ib2 === 3 ? WEIGHTS3 : WEIGHTS4;
    secondaryIdx[0] = read(ib2 - 1); // anchor at 0
    for (let i = 1; i < 16; i++) {
      secondaryIdx[i] = read(ib2);
    }
  }

  // Interpolate and output
  const weights2arr = ib2 === 2 ? WEIGHTS2 : ib2 === 3 ? WEIGHTS3 : WEIGHTS4;

  for (let i = 0; i < 16; i++) {
    const s = getPartition(numSubsets, partition, i);
    const e0 = ep[s][0];
    const e1 = ep[s][1];

    let colorWeight, alphaWeight;

    if (ib2 > 0) {
      // Modes 4, 5 have separate color and alpha indices
      if (idxSel === 0) {
        colorWeight = weights1[primaryIdx[i]];
        alphaWeight = weights2arr[secondaryIdx[i]];
      } else {
        colorWeight = weights2arr[secondaryIdx[i]];
        alphaWeight = weights1[primaryIdx[i]];
      }
    } else {
      colorWeight = weights1[primaryIdx[i]];
      alphaWeight = colorWeight;
    }

    let r = ((64 - colorWeight) * e0[0] + colorWeight * e1[0] + 32) >> 6;
    let g = ((64 - colorWeight) * e0[1] + colorWeight * e1[1] + 32) >> 6;
    let b = ((64 - colorWeight) * e0[2] + colorWeight * e1[2] + 32) >> 6;
    let a = ((64 - alphaWeight) * e0[3] + alphaWeight * e1[3] + 32) >> 6;

    // Apply rotation (modes 4, 5)
    if (rotation === 1) { const t = a; a = r; r = t; }
    else if (rotation === 2) { const t = a; a = g; g = t; }
    else if (rotation === 3) { const t = a; a = b; b = t; }

    pixels[i * 4]     = Math.max(0, Math.min(255, r));
    pixels[i * 4 + 1] = Math.max(0, Math.min(255, g));
    pixels[i * 4 + 2] = Math.max(0, Math.min(255, b));
    pixels[i * 4 + 3] = Math.max(0, Math.min(255, a));
  }

  return pixels;
}

export function decodeBC7(data, offset, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  let off = offset;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const block = decodeBC7Block(data, off);
      off += 16;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < width && y < height) {
            const si = (py * 4 + px) * 4;
            const di = (y * width + x) * 4;
            pixels[di]     = block[si];
            pixels[di + 1] = block[si + 1];
            pixels[di + 2] = block[si + 2];
            pixels[di + 3] = block[si + 3];
          }
        }
      }
    }
  }
  return pixels;
}
