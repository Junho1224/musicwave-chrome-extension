"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { inflateSync } = require("node:zlib");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("the notification PNG has valid checksums and decompresses completely", () => {
  const root = join(__dirname, "..");
  const background = readFileSync(join(root, "background.js"), "utf8");
  const icon = background.match(/const NOTIFICATION_ICON = "([^"]+)"/)[1];
  const png = icon.startsWith("data:") ? Buffer.from(icon.split(",")[1], "base64")
    : readFileSync(join(root, icon));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const compressed = [];
  let width, height;
  let sawEnd = false;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const chunk = png.subarray(offset + 4, offset + 8 + length);
    assert.equal(crc32(chunk), png.readUInt32BE(offset + 8 + length), `${type} checksum`);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(4);
      height = chunk.readUInt32BE(8);
      assert.equal(chunk[12], 8);
      assert.equal(chunk[13], 6);
    }
    if (type === "IDAT") compressed.push(chunk.subarray(4));
    if (type === "IEND") sawEnd = true;
    offset += length + 12;
  }
  assert.equal(sawEnd, true);
  assert.equal(inflateSync(Buffer.concat(compressed)).length, height * (width * 4 + 1));
});
