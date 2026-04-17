import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

/**
 * Copies a SQLite DB (plus -wal/-shm sidecars) to a throwaway temp dir
 * and opens it read-only. Needed because the Lassen app keeps the original
 * files locked while running.
 */
export function openLassenDbReadonly(sourcePath: string): {
  db: Database.Database;
  close: () => void;
} {
  if (!existsSync(sourcePath)) {
    throw new Error(`SQLite source not found: ${sourcePath}`);
  }
  const work = mkdtempSync(join(tmpdir(), "kindle-catalog-"));
  const target = join(work, basename(sourcePath));
  copyFileSync(sourcePath, target);
  for (const suffix of ["-wal", "-shm"]) {
    const side = sourcePath + suffix;
    if (existsSync(side)) copyFileSync(side, target + suffix);
  }
  const db = new Database(target, { readonly: true, fileMustExist: true });
  return {
    db,
    close: () => {
      db.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}
