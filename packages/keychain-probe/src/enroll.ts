import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeBundleFiles, listBooks, type BookEntry } from "@kindle/catalog";
import { readDrmionFile } from "@kindle/drmion";
import { bruteForceKey } from "./bruteForce.js";
import { findKindlePid } from "./findKindle.js";
import { dumpSmallRegions } from "./memoryDump.js";
import {
  DEFAULT_KEYS_PATH,
  loadKeys,
  saveKeys,
  upsertKey,
  type StoredKey,
} from "./keysStore.js";

export type EnrollOptions = {
  /** Numerical ASIN, without the `A:` prefix. */
  asin: string;
  /** Override the default keys.json path. */
  keysPath?: string;
  /**
   * Where to write the intermediate memory dump. Default: mkdtemp under
   * os.tmpdir(). The directory is NOT cleaned up automatically so it can be
   * re-used by debugging.
   */
  workDir?: string;
  /** How many (ct, iv) pairs to feed the brute-forcer. Default 5. */
  numPairs?: number;
  /** Logger hook; defaults to console.error. */
  log?: (msg: string) => void;
};

export type EnrollResult = {
  asin: string;
  contentKeyUuid: string;
  keyHex: string;
  dumpOffset: number;
  dumpSizeMiB: number;
  elapsedSeconds: number;
};

export class EnrollError extends Error {
  constructor(message: string, public readonly kind: EnrollErrorKind) {
    super(message);
    this.name = "EnrollError";
  }
}
export type EnrollErrorKind =
  | "book-not-found"
  | "bundle-incomplete"
  | "kindle-not-running"
  | "dump-failed"
  | "key-not-found-in-memory";

/**
 * One-shot enrollment for a single book ASIN.
 *
 * Pre-conditions the caller is responsible for:
 *   - The Kindle app is running
 *   - The target book ASIN has been OPENED in Kindle (otherwise the content
 *     key is not resident in the app's heap)
 *   - Either SIP is disabled, OR the invoking terminal has been granted TCC
 *     "Developer Tools" permission in System Settings → Privacy & Security
 */
export async function enroll(opts: EnrollOptions): Promise<EnrollResult> {
  const log = opts.log ?? ((m) => console.error(m));
  const numPairs = Math.max(2, opts.numPairs ?? 5);
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), "kindle-enroll-"));
  const keysPath = opts.keysPath ?? DEFAULT_KEYS_PATH;

  const book = findBook(opts.asin);
  log(`book: ${book.title} (${book.asin})`);

  const bundle = describeBundleFiles(book.bundlePath);
  if (bundle.azw8.length === 0) {
    throw new EnrollError(
      `no .azw8 payload found in bundle ${book.bundlePath}`,
      "bundle-incomplete",
    );
  }

  // Pull (ct, iv) pairs out of the first .azw8 — for a text ebook there is
  // exactly one. Resources / metadata files use the same keys.
  const drmion = readDrmionFile(bundle.azw8[0]!, numPairs);
  if (drmion.pairs.length < 2) {
    throw new EnrollError(
      `only ${drmion.pairs.length} encrypted chunks in ${bundle.azw8[0]} — need at least 2 for a collision-proof brute-force`,
      "bundle-incomplete",
    );
  }
  log(
    `ciphertext spec: ${drmion.metadata.cipherSpec}  ` +
      `content-key=${drmion.metadata.contentKeyUuid}  ` +
      `chunks=${drmion.pairs.length}`,
  );

  const pid = findKindlePid();
  if (pid === null) {
    throw new EnrollError(
      "Kindle (com.amazon.Lassen) is not running. Start it and open the book first.",
      "kindle-not-running",
    );
  }
  log(`kindle pid: ${pid}`);

  log(`dumping writable heap (small regions only) via lldb...`);
  const start = Date.now();
  let dump;
  try {
    dump = dumpSmallRegions(pid, workDir);
  } catch (e) {
    throw new EnrollError(
      `memory dump failed: ${(e as Error).message}\n` +
        `If you are on SIP-on macOS: go to System Settings → Privacy & Security → Developer Tools, ` +
        `add your terminal (or this process' host app), and retry.`,
      "dump-failed",
    );
  }
  log(
    `dump: ${dump.dumpPath}  ${(dump.sizeBytes / 1024 / 1024).toFixed(1)} MiB ` +
      `(${((Date.now() - start) / 1000).toFixed(1)}s)`,
  );

  log(`brute-forcing AES key against ${drmion.pairs.length} (ct, iv) pairs...`);
  const scanStart = Date.now();
  const hits = bruteForceKey({
    dumpPath: dump.dumpPath,
    pairs: drmion.pairs.map((p) => ({
      ciphertext: Buffer.from(p.ciphertext),
      iv: Buffer.from(p.iv),
    })),
    keySizes: [16, 24, 32],
    stride: 8,
    maxHits: 1,
  });
  if (hits.length === 0) {
    throw new EnrollError(
      `no AES key found in dump. Ensure the book "${book.title}" is actually opened in Kindle (reader view, not the library grid).`,
      "key-not-found-in-memory",
    );
  }
  const hit = hits[0]!;
  const scanSec = (Date.now() - scanStart) / 1000;
  log(
    `key found: offset=0x${hit.offset.toString(16)} bits=${hit.keyBits}  ` +
      `key=${hit.keyHex}  preview=${hit.plaintextPreviewHex} ` +
      `(${scanSec.toFixed(1)}s scan)`,
  );

  const stored: StoredKey = {
    keyUuid: drmion.metadata.contentKeyUuid,
    keyHex: hit.keyHex,
    bits: hit.keyBits,
    extractedAt: new Date().toISOString(),
    source: "memory-brute-force",
  };
  const keys = loadKeys(keysPath);
  saveKeys(upsertKey(keys, book.asin, stored), keysPath);
  log(`saved to ${keysPath}`);

  return {
    asin: book.asin,
    contentKeyUuid: drmion.metadata.contentKeyUuid,
    keyHex: hit.keyHex,
    dumpOffset: hit.offset,
    dumpSizeMiB: dump.sizeBytes / 1024 / 1024,
    elapsedSeconds: (Date.now() - start) / 1000,
  };
}

function findBook(asin: string): BookEntry {
  const needle = asin.toUpperCase();
  const match = listBooks({ includeMissing: true }).find(
    (b) => b.asin.toUpperCase() === needle,
  );
  if (!match) {
    throw new EnrollError(
      `ASIN ${asin} not found among locally downloaded KFX books. Run 'kindle list' to see available books.`,
      "book-not-found",
    );
  }
  return match;
}
