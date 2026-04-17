import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Default location of the key store.
 *
 * On macOS the conventional place would be
 *   ~/Library/Application Support/kindle-extractor/keys.json
 * but most users can reason about `~/.config/*` more easily and that's what
 * the rest of the project uses in its docs. `KINDLE_KEYS_PATH` env var
 * overrides for tests.
 */
export const DEFAULT_KEYS_PATH = (() => {
  const override = process.env.KINDLE_KEYS_PATH;
  if (override) return override;
  return join(homedir(), ".config/kindle-extractor/keys.json");
})();

/** Version bump when the schema changes in a breaking way. */
const STORE_VERSION = 1;

export type StoredKey = {
  /** amzn1.drm-key.v1.<uuid> */
  keyUuid: string;
  /** Hex-encoded AES key bytes */
  keyHex: string;
  /** 128 | 192 | 256 */
  bits: number;
  /** ISO 8601 UTC timestamp of when the key was extracted. */
  extractedAt: string;
  /** How we got it — for audit and for re-extraction when it stops working. */
  source: "memory-brute-force" | "manual" | "other";
};

export type KeysFileV1 = {
  version: typeof STORE_VERSION;
  /**
   * Keyed by ASIN (e.g. "B0090RVGW0"). One book can reference multiple keys
   * (content key + signature key). Under each ASIN we keep a map keyUuid → StoredKey.
   */
  books: Record<string, Record<string, StoredKey>>;
};

export function loadKeys(path: string = DEFAULT_KEYS_PATH): KeysFileV1 {
  if (!existsSync(path)) {
    return { version: STORE_VERSION, books: {} };
  }
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as KeysFileV1;
  if (parsed.version !== STORE_VERSION) {
    throw new Error(
      `keys file at ${path} has version ${parsed.version}; this tool expects ${STORE_VERSION}`,
    );
  }
  return parsed;
}

export function saveKeys(data: KeysFileV1, path: string = DEFAULT_KEYS_PATH): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function upsertKey(
  data: KeysFileV1,
  asin: string,
  key: StoredKey,
): KeysFileV1 {
  const forBook = { ...(data.books[asin] ?? {}) };
  forBook[key.keyUuid] = key;
  return {
    ...data,
    books: { ...data.books, [asin]: forBook },
  };
}

export function getKey(
  data: KeysFileV1,
  asin: string,
  keyUuid: string,
): StoredKey | undefined {
  return data.books[asin]?.[keyUuid];
}
