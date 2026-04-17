import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

export type CipherPair = { ciphertext: Buffer; iv: Buffer };
export type BruteForceOptions = {
  /** Path to the concatenated memory dump (from memoryDump.ts) */
  dumpPath: string;
  /** At least 2 pairs recommended; 5 gives effectively zero false positives. */
  pairs: CipherPair[];
  /** AES key sizes to try, in bytes. Default: all three (16, 24, 32). */
  keySizes?: number[];
  /** Sliding window stride (in bytes). Default 8 (heap alignment). */
  stride?: number;
  /** Stop after finding N keys (for diagnostics). Default 1. */
  maxHits?: number;
};

export type BruteForceHit = {
  offset: number;
  keyBits: 128 | 192 | 256;
  keyHex: string;
  /** Preview of the first 32 bytes of plaintext after decrypting the first pair. */
  plaintextPreviewHex: string;
};

/**
 * Slide a window across `dumpPath` looking for an AES key that, together with
 * the provided IV, produces valid PKCS#7 padding on ALL of the given
 * ciphertexts. With ≥3 independent (ct, iv) pairs the false-positive rate is
 * effectively zero.
 */
export function bruteForceKey(opts: BruteForceOptions): BruteForceHit[] {
  const { pairs } = opts;
  if (pairs.length === 0) throw new Error("need at least one (ct, iv) pair");
  for (const p of pairs) {
    if (p.ciphertext.length % 16 !== 0 || p.ciphertext.length === 0) {
      throw new Error(`bad ciphertext length ${p.ciphertext.length}`);
    }
    if (p.iv.length !== 16) {
      throw new Error(`bad iv length ${p.iv.length}`);
    }
  }
  const sizes = (opts.keySizes ?? [16, 24, 32]).filter((s) => [16, 24, 32].includes(s));
  const stride = Math.max(1, opts.stride ?? 8);
  const maxHits = Math.max(1, opts.maxHits ?? 1);
  const dump = readFileSync(opts.dumpPath);

  const hits: BruteForceHit[] = [];
  for (const size of sizes) {
    const alg = `aes-${size * 8}-cbc`;
    const maxOffset = dump.length - size;
    for (let off = 0; off <= maxOffset; off += stride) {
      const key = dump.subarray(off, off + size);
      if (isTrivial(key)) continue;
      if (!tryAllPairs(alg, key, pairs)) continue;
      // Hit. Produce preview via pair 0.
      try {
        const d = createDecipheriv(alg, key, pairs[0]!.iv);
        d.setAutoPadding(true);
        const pt = Buffer.concat([d.update(pairs[0]!.ciphertext), d.final()]);
        hits.push({
          offset: off,
          keyBits: (size * 8) as 128 | 192 | 256,
          keyHex: key.toString("hex"),
          plaintextPreviewHex: pt.subarray(0, 32).toString("hex"),
        });
      } catch {
        // Shouldn't happen — tryAllPairs already validated.
      }
      if (hits.length >= maxHits) return hits;
    }
  }
  return hits;
}

function tryAllPairs(alg: string, key: Buffer, pairs: CipherPair[]): boolean {
  try {
    for (const p of pairs) {
      const d = createDecipheriv(alg, key, p.iv);
      d.setAutoPadding(true);
      Buffer.concat([d.update(p.ciphertext), d.final()]);
    }
    return true;
  } catch {
    return false;
  }
}

function isTrivial(buf: Buffer): boolean {
  const f = buf[0];
  if (f === undefined) return true;
  for (let i = 1; i < buf.length; i++) if (buf[i] !== f) return false;
  return true;
}
