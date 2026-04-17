#!/usr/bin/env -S node --experimental-strip-types
/**
 * Offline AES-key brute-force against a memory dump. Each candidate window
 * is tested against *multiple* (ciphertext, iv) pairs; only keys that yield
 * valid PKCS7 padding on ALL pairs are accepted. That drops the false-positive
 * rate from ~1/256 (single-pair) to ~1/256^n for n pairs.
 *
 * Usage:
 *   node brute-force-key.ts <dump-path> <pairs.json> [key-sizes=16,24,32] [stride=1]
 *
 * pairs.json: array of { ciphertext: hex, iv: hex }
 */
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

const [, , dumpPath, pairsPath, sizesArg, strideArg] = process.argv;
if (!dumpPath || !pairsPath) {
  console.error("usage: brute-force-key.ts <dump-path> <pairs.json> [key-sizes=16,24,32] [stride=1]");
  process.exit(1);
}

const pairs = (JSON.parse(readFileSync(pairsPath, "utf8")) as { ciphertext: string; iv: string }[])
  .map((p) => ({
    ciphertext: Buffer.from(p.ciphertext, "hex"),
    iv: Buffer.from(p.iv, "hex"),
  }));

if (pairs.length < 2) {
  console.warn("warning: only 1 pair provided — false-positive rate will be high");
}
for (const p of pairs) {
  if (p.ciphertext.length % 16 !== 0 || p.ciphertext.length === 0) {
    console.error(`bad ciphertext length ${p.ciphertext.length}`);
    process.exit(1);
  }
  if (p.iv.length !== 16) {
    console.error(`bad iv length ${p.iv.length}`);
    process.exit(1);
  }
}

const sizes = (sizesArg ?? "16,24,32").split(",").map((s) => parseInt(s.trim(), 10));
const stride = Math.max(1, parseInt(strideArg ?? "1", 10));

console.log(`dump:    ${dumpPath}`);
console.log(`pairs:   ${pairs.length}`);
console.log(`sizes:   ${sizes.join(",")}`);
console.log(`stride:  ${stride}`);
console.log();

const dump = readFileSync(dumpPath);
console.log(`loaded ${(dump.length / 1024 / 1024).toFixed(1)} MiB`);

function tryKey(alg: string, key: Buffer): string | null {
  try {
    for (const p of pairs) {
      const d = createDecipheriv(alg, key, p.iv);
      d.setAutoPadding(true);
      // Tail-only decrypt to save work: decrypt the last two blocks
      // (previous block + padded block) to validate PKCS7.
      const ct = p.ciphertext;
      const tail = ct.subarray(ct.length - 32);
      // CBC requires the state of the previous block. Feed the ct up to tail to prime state.
      // Easier: decrypt the whole thing. autoPadding=true triggers .final() to validate.
      Buffer.concat([d.update(ct), d.final()]);
    }
    // Run one more time on pair 0 to get a preview of the plaintext.
    const d = createDecipheriv(alg, key, pairs[0]!.iv);
    d.setAutoPadding(true);
    const pt = Buffer.concat([d.update(pairs[0]!.ciphertext), d.final()]);
    return pt.subarray(0, 32).toString("hex");
  } catch {
    return null;
  }
}

for (const size of sizes) {
  if (![16, 24, 32].includes(size)) continue;
  const alg = `aes-${size * 8}-cbc`;
  console.log(`\n=== ${alg} (stride=${stride}) ===`);
  const maxOffset = dump.length - size;
  const start = Date.now();
  let tried = 0;
  const hits: { offset: number; key: string; preview: string }[] = [];

  for (let off = 0; off <= maxOffset; off += stride) {
    tried++;
    const key = dump.subarray(off, off + size);
    if (isTrivial(key)) continue;
    const preview = tryKey(alg, key);
    if (preview !== null) {
      hits.push({ offset: off, key: key.toString("hex"), preview });
      console.log(`  HIT offset=0x${off.toString(16)}  key=${key.toString("hex")}  preview=${preview}`);
      if (hits.length >= 10) break;
    }
    if (tried % 5_000_000 === 0) {
      const el = (Date.now() - start) / 1000;
      const rate = tried / el;
      const eta = (maxOffset - off) / stride / rate;
      console.log(
        `  ${(off / 1024 / 1024).toFixed(0)}/${(dump.length / 1024 / 1024).toFixed(0)} MiB ` +
          ` ${(tried / 1e6).toFixed(1)}M tried  rate=${(rate / 1e6).toFixed(2)}M/s  eta=${eta.toFixed(0)}s  hits=${hits.length}`,
      );
    }
  }
  const el = (Date.now() - start) / 1000;
  console.log(`done: ${tried} candidates in ${el.toFixed(1)}s → ${hits.length} keys`);
}

function isTrivial(buf: Buffer): boolean {
  const f = buf[0];
  if (f === undefined) return true;
  for (let i = 1; i < buf.length; i++) if (buf[i] !== f) return false;
  return true;
}
