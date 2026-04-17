import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Path to the Python LLDB script that dumps all small writable regions
 * of a target process. Lives in `scripts/dump_small.py` next to the
 * shipped package.
 */
const DUMP_SMALL_PY = resolve(HERE, "..", "scripts", "dump_small.py");

export type MemoryDumpResult = {
  dumpPath: string;
  indexPath: string;
  sizeBytes: number;
};

/**
 * Attach lldb to a running process, enumerate its writable memory regions
 * that fall within a reasonable size window (4 KiB .. 4 MiB — heap-sized,
 * not giant graphics buffers), concatenate them into a single blob, and
 * also write an index file that maps dump-offset → virtual-address.
 *
 * Requires:
 *   - Xcode Command Line Tools (`/usr/bin/lldb` present and functional)
 *   - Either SIP off, or TCC "Developer Tools" permission granted to the
 *     process that invokes us (Terminal/iTerm/Code/etc.)
 *
 * Does NOT require the caller to have any keychain-access-group entitlement;
 * only process-debug rights.
 */
export function dumpSmallRegions(pid: number, outDir: string): MemoryDumpResult {
  if (!existsSync(DUMP_SMALL_PY)) {
    throw new Error(`dump_small.py not found at ${DUMP_SMALL_PY}`);
  }
  mkdirSync(outDir, { recursive: true });
  const res = spawnSync(
    "lldb",
    [
      "--batch",
      "-p",
      String(pid),
      "-o",
      `command script import ${DUMP_SMALL_PY}`,
      "-o",
      "dump_small",
      "-o",
      "process detach",
      "-o",
      "quit",
    ],
    { encoding: "utf8", env: { ...process.env, KINDLE_DUMP_DIR: outDir } },
  );
  if (res.status !== 0) {
    throw new DumpFailedError(
      `lldb exited with status ${res.status}:\n${res.stderr || res.stdout}`,
      res,
    );
  }
  const dumpPath = join(outDir, "small.bin");
  const indexPath = join(outDir, "small.index");
  if (!existsSync(dumpPath)) {
    throw new DumpFailedError(
      `dump_small.py completed but dump not found at ${dumpPath}:\n${res.stdout}`,
      res,
    );
  }
  return {
    dumpPath,
    indexPath,
    sizeBytes: statSync(dumpPath).size,
  };
}

export class DumpFailedError extends Error {
  constructor(message: string, public readonly spawnResult: ReturnType<typeof spawnSync>) {
    super(message);
    this.name = "DumpFailedError";
  }
}
