#!/usr/bin/env -S node --experimental-strip-types
/**
 * Verify a candidate AES key end-to-end:
 *   decrypt chunk 1 → inspect plaintext → attempt LZMA "alone" decompression
 *   (which should produce a Kindle Ion content fragment).
 */
import { createDecipheriv } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { IonTypes, makeReader } from "ion-js";

const [, , pairsPath, keyHex, size] = process.argv;
if (!pairsPath || !keyHex) {
  console.error("usage: verify-key.ts <pairs.json> <key-hex> [128|192|256]");
  process.exit(1);
}

const pairs = JSON.parse(readFileSync(pairsPath, "utf8")) as { ciphertext: string; iv: string }[];
const key = Buffer.from(keyHex, "hex");
const bits = size ?? String(key.length * 8);
const alg = `aes-${bits}-cbc`;

console.log(`pairs:   ${pairsPath} (${pairs.length} chunks)`);
console.log(`key:     ${keyHex} (${key.length}B, ${bits}-bit)`);
console.log(`alg:     ${alg}\n`);

for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]!;
  const d = createDecipheriv(alg, key, Buffer.from(p.iv, "hex"));
  d.setAutoPadding(true);
  const pt = Buffer.concat([d.update(Buffer.from(p.ciphertext, "hex")), d.final()]);
  console.log(`--- chunk ${i} ---`);
  console.log(`decrypted plaintext: ${pt.length} bytes`);
  console.log(`first 32 bytes hex:  ${pt.subarray(0, 32).toString("hex")}`);

  // Expected structure observed from first-chunk preview:
  //   [1 byte flag = 0x00]
  //   [5-byte LZMA header: properties + dict-size-LE]
  //   [8-byte uncompressed length LE]
  //   [LZMA-compressed payload]
  if (pt[0] === 0x00 && pt[1] === 0x5d) {
    const dict = pt.readUInt32LE(2);
    const uncompressed = Number(pt.readBigUInt64LE(6));
    console.log(`lzma header:         properties=0x5d  dict=${dict} (${(dict/1024/1024).toFixed(1)} MiB)  uncompressed=${uncompressed}`);
    // Repack as standard lzma-alone: [1 prop][4 dict][8 size][data]
    // (i.e. drop the leading flag byte)
    const lzmaAlone = Buffer.concat([pt.subarray(1, 14), pt.subarray(14)]);
    const tmpIn = `/tmp/kindle-verify-${i}.lzma`;
    const tmpOut = `/tmp/kindle-verify-${i}.bin`;
    writeFileSync(tmpIn, lzmaAlone);
    const res = spawnSync("xz", ["--decompress", "--format=lzma", "--stdout", tmpIn], {
      encoding: "buffer",
    });
    if (res.status !== 0) {
      console.log(`xz decompress failed: ${res.stderr?.toString()}`);
      continue;
    }
    const raw = res.stdout;
    writeFileSync(tmpOut, raw);
    console.log(`lzma decompressed:   ${raw.length} bytes  → ${tmpOut}`);
    console.log(`first 32 bytes hex:  ${raw.subarray(0, 32).toString("hex")}`);
    // Ion preview
    if (raw[0] === 0xe0 && raw[1] === 0x01 && raw[2] === 0x00 && raw[3] === 0xea) {
      console.log(`→ valid Ion Binary 1.0 stream ✅`);
      try {
        const r = makeReader(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
        let nodes = 0;
        while (r.next() && nodes++ < 3) {
          console.log(`ion top-level: type=${r.type()?.name ?? "?"}`);
        }
      } catch (e) {
        console.log(`ion parse error (expected without symbol table): ${(e as Error).message}`);
      }
    } else {
      // Not starting with BVM — could still be valid raw Ion payload referencing a shared symbol table
      console.log(`(no Ion BVM; payload may be raw Ion referencing a preset symbol context)`);
    }
  } else {
    console.log(`(no recognizable LZMA-alone header at offset 0/1)`);
  }
  console.log();
}
