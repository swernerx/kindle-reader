#!/usr/bin/env -S node --experimental-strip-types
/**
 * Extract multiple (ciphertext, iv) pairs from a DRMION file as JSON.
 * Prints a JSON array to stdout for consumption by brute-force-key.ts.
 */
import { readFileSync } from "node:fs";
import { IonTypes, makeReader } from "ion-js";

const path = process.argv[2];
const maxStr = process.argv[3];
const max = maxStr ? parseInt(maxStr, 10) : 5;
if (!path) {
  console.error("usage: extract-chunks.ts <path-to-azw8> [max=5]");
  process.exit(1);
}

const bytes = readFileSync(path);
const ion = new Uint8Array(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
const reader = makeReader(ion);

type Pair = { ciphertext: string; iv: string };
const pairs: Pair[] = [];

outer: while (reader.next()) {
  if (reader.type() !== IonTypes.LIST) continue;
  reader.stepIn();
  let structIdx = 0;
  while (reader.next()) {
    if (reader.type() !== IonTypes.STRUCT) continue;
    if (structIdx === 0) {
      structIdx++;
      continue; // skip metadata struct
    }
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
      const iv = blobs.find((b) => b.length === 16);
      const ct = blobs.find((b) => b.length !== 16 && b.length % 16 === 0);
      if (iv && ct) {
        pairs.push({
          ciphertext: Buffer.from(ct).toString("hex"),
          iv: Buffer.from(iv).toString("hex"),
        });
        if (pairs.length >= max) break outer;
      }
    }
    structIdx++;
  }
  reader.stepOut();
}

console.log(JSON.stringify(pairs, null, 2));
