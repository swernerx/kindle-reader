#!/usr/bin/env -S node --experimental-strip-types
/**
 * Extract the first (ciphertext, iv) pair from a DRMION file so we can feed
 * it into the brute-forcer. Prints ciphertext and iv as hex to stdout.
 */
import { readFileSync } from "node:fs";
import { IonTypes, makeReader } from "ion-js";

const path = process.argv[2];
if (!path) {
  console.error("usage: extract-chunk.ts <path-to-azw8-or-res-or-md>");
  process.exit(1);
}

const bytes = readFileSync(path);
const ion = new Uint8Array(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
const reader = makeReader(ion);

// The DRMION Ion stream is: symbol, then one or more top-level lists.
// Each list is: [metadata-struct, {ciphertext, iv}, {ciphertext, iv}, ..., {signature}]
// Walk to the first list, skip the metadata struct, return the first {ciphertext, iv} struct.

let chunkCipher: Uint8Array | null = null;
let chunkIv: Uint8Array | null = null;

outer: while (reader.next()) {
  const t = reader.type();
  if (t !== IonTypes.LIST) continue;
  reader.stepIn();
  let structIdx = 0;
  while (reader.next()) {
    if (reader.type() !== IonTypes.STRUCT) continue;
    if (structIdx === 0) {
      // skip metadata struct
      structIdx++;
      continue;
    }
    // first data struct
    reader.stepIn();
    const blobs: Uint8Array[] = [];
    while (reader.next()) {
      if (reader.type() === IonTypes.BLOB) {
        const v = reader.uInt8ArrayValue();
        if (v) blobs.push(v);
      }
    }
    reader.stepOut();
    if (blobs.length >= 2) {
      // Heuristic: the longer blob is ciphertext, the 16-byte one is IV.
      chunkCipher = blobs[0]!.length === 16 ? blobs[1]! : blobs[0]!;
      chunkIv = blobs[0]!.length === 16 ? blobs[0]! : blobs[1]!;
      if (chunkCipher.length !== 16 && chunkIv.length === 16) {
        break outer;
      }
    }
    structIdx++;
  }
  reader.stepOut();
}

if (!chunkCipher || !chunkIv) {
  console.error("no (ciphertext, iv) pair found");
  process.exit(2);
}
console.log(`ciphertext=${Buffer.from(chunkCipher).toString("hex")}`);
console.log(`iv=${Buffer.from(chunkIv).toString("hex")}`);
console.log(`ciphertext_length=${chunkCipher.length}`);
