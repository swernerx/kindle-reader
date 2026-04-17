import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LASSEN_PATHS } from "./paths.js";
import { openLassenDbReadonly } from "./safeSqlite.js";

export type BookEntry = {
  /** "A:<ASIN>-0" as stored in BookData.sqlite */
  bookId: string;
  /** Plain ASIN, derived from bookId */
  asin: string;
  title: string;
  /**
   * Encrypted author BLOB from ZDISPLAYAUTHOR. Hex-encoded so it is safe
   * to serialize. Decoding needs the Lassen keychain key (Phase 2+).
   */
  authorCipherHex: string | null;
  /** Absolute local path: <container>/<ZPATH> */
  bundlePath: string;
  /** True if the bundle directory actually exists on disk */
  bundleExists: boolean;
  sizeBytes: number | null;
  currentPosition: number | null;
  maxPosition: number | null;
  /** Read fraction 0..1, null if unknown */
  progress: number | null;
  /** 0 = unread, 1 = finished, null if unknown */
  readState: number | null;
  /** ZRAWISENCRYPTED from DB — may be stale; files have DRMION header regardless */
  dbEncryptedFlag: number | null;
  mimeType: string | null;
  language: string | null;
  /** Cover file absolute path if a local PNG could be resolved */
  coverFile: string | null;
  /** Cover URL from StartActions.data JSON, when available */
  coverUrl: string | null;
};

type BookRow = {
  ZBOOKID: string | null;
  ZDISPLAYTITLE: string | null;
  ZDISPLAYAUTHOR: Buffer | null;
  ZPATH: string | null;
  ZRAWFILESIZE: number | null;
  ZRAWCURRENTPOSITION: number | null;
  ZRAWMAXPOSITION: number | null;
  ZRAWREADSTATE: number | null;
  ZRAWISENCRYPTED: number | null;
  ZMIMETYPE: string | null;
  ZLANGUAGE: string | null;
};

const DEFAULT_MIMES = ["application/x-kfx-ebook"];
const DEFAULT_STATES = [3];

export type CatalogOptions = {
  /**
   * Which MIME types to include. Default: KFX only. The Lassen DB also holds
   * mobipocket (old Instapaper-era imports) and audible entries — not in scope.
   */
  mimeTypes?: string[];
  /**
   * ZRAWBOOKSTATE values to include. State 3 = locally downloaded. State 0 =
   * cloud-only reference (file not on disk).
   */
  bookStates?: number[];
  /** Include entries whose bundle directory does not exist on disk. */
  includeMissing?: boolean;
};

export function listBooks(opts: CatalogOptions = {}): BookEntry[] {
  const mimeTypes = opts.mimeTypes ?? DEFAULT_MIMES;
  const bookStates = opts.bookStates ?? DEFAULT_STATES;

  const { db, close } = openLassenDbReadonly(LASSEN_PATHS.bookDataDb);
  try {
    const mimePh = mimeTypes.map(() => "?").join(",");
    const statePh = bookStates.map(() => "?").join(",");
    const stmt = db.prepare(`
      SELECT ZBOOKID, ZDISPLAYTITLE, ZDISPLAYAUTHOR, ZPATH,
             ZRAWFILESIZE, ZRAWCURRENTPOSITION, ZRAWMAXPOSITION,
             ZRAWREADSTATE, ZRAWISENCRYPTED, ZMIMETYPE, ZLANGUAGE
      FROM ZBOOK
      WHERE ZPATH IS NOT NULL
        AND ZMIMETYPE IN (${mimePh})
        AND ZRAWBOOKSTATE IN (${statePh})
      ORDER BY ZDISPLAYTITLE COLLATE NOCASE
    `);
    const rows = stmt.all(...mimeTypes, ...bookStates) as BookRow[];
    const entries: BookEntry[] = [];
    for (const r of rows) {
      if (!r.ZPATH || !r.ZBOOKID) continue;
      const bundlePath = join(LASSEN_PATHS.sandbox, r.ZPATH);
      const bundleExists = existsSync(bundlePath);
      if (!bundleExists && !opts.includeMissing) continue;

      const asin = r.ZBOOKID.replace(/^A:/, "").replace(/-\d+$/, "");
      const maxPos = r.ZRAWMAXPOSITION ?? null;
      const curPos = r.ZRAWCURRENTPOSITION ?? null;
      const progress =
        maxPos && maxPos > 0 && curPos != null
          ? Math.min(1, Math.max(0, curPos / maxPos))
          : null;

      const { coverFile, coverUrl } = resolveCover(bundlePath, asin);

      entries.push({
        bookId: r.ZBOOKID,
        asin,
        title: r.ZDISPLAYTITLE ?? "(kein Titel)",
        authorCipherHex: r.ZDISPLAYAUTHOR
          ? r.ZDISPLAYAUTHOR.toString("hex")
          : null,
        bundlePath,
        bundleExists,
        sizeBytes: r.ZRAWFILESIZE ?? null,
        currentPosition: curPos,
        maxPosition: maxPos,
        progress,
        readState: r.ZRAWREADSTATE ?? null,
        dbEncryptedFlag: r.ZRAWISENCRYPTED ?? null,
        mimeType: r.ZMIMETYPE ?? null,
        language: r.ZLANGUAGE ?? null,
        coverFile,
        coverUrl,
      });
    }
    return entries;
  } finally {
    close();
  }
}

function resolveCover(
  bundlePath: string,
  asin: string,
): { coverFile: string | null; coverUrl: string | null } {
  let coverUrl: string | null = null;
  if (existsSync(bundlePath)) {
    const candidates = readdirSync(bundlePath).filter((n) =>
      n.startsWith("StartActions.data.") && n.endsWith(".asc"),
    );
    for (const name of candidates) {
      try {
        const raw = readFileSync(join(bundlePath, name), "utf8");
        const parsed = JSON.parse(raw) as {
          bookInfo?: { imageUrl?: string };
        };
        if (parsed.bookInfo?.imageUrl) {
          coverUrl = parsed.bookInfo.imageUrl;
          break;
        }
      } catch {
        // ignore, not fatal
      }
    }
  }

  let coverFile: string | null = null;
  if (existsSync(LASSEN_PATHS.coversCache)) {
    for (const name of readdirSync(LASSEN_PATHS.coversCache)) {
      if (!name.toLowerCase().endsWith(".png")) continue;
      if (name.toLowerCase().includes(asin.toLowerCase())) {
        coverFile = join(LASSEN_PATHS.coversCache, name);
        break;
      }
    }
  }
  return { coverFile, coverUrl };
}

export function describeBundleFiles(bundlePath: string): {
  azw8: string[];
  azw9Res: string[];
  azw9Md: string[];
  manifest: string | null;
  voucher: string | null;
  sidecarJson: string[];
  totalBytes: number;
} {
  const out = {
    azw8: [] as string[],
    azw9Res: [] as string[],
    azw9Md: [] as string[],
    manifest: null as string | null,
    voucher: null as string | null,
    sidecarJson: [] as string[],
    totalBytes: 0,
  };
  if (!existsSync(bundlePath)) return out;
  for (const name of readdirSync(bundlePath)) {
    const full = join(bundlePath, name);
    try {
      out.totalBytes += statSync(full).size;
    } catch {
      // ignore
    }
    if (name.endsWith(".azw8")) out.azw8.push(full);
    else if (name.endsWith(".azw9.res")) out.azw9Res.push(full);
    else if (name.endsWith(".azw9.md")) out.azw9Md.push(full);
    else if (name === "BookManifest.kfx") out.manifest = full;
    else if (name.endsWith(".voucher")) out.voucher = full;
    else if (name.endsWith(".asc")) out.sidecarJson.push(full);
  }
  return out;
}
