"use strict";

const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { deflateSync } = require("node:zlib");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, checksum]);
}

const size = 128;
const pixels = Buffer.alloc(size * (size * 4 + 1));
const heights = [30, 54, 82, 54, 30];
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const bar = heights.findIndex((height, index) =>
      x >= 26 + index * 16 && x < 38 + index * 16 && Math.abs(y - 64) < height / 2);
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(bar >= 0 ? [0, 205, 60, 255] : [14, 17, 15, 255], offset);
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))
]);
const destination = join(__dirname, "..", "icons");
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, "notification.png"), png);
