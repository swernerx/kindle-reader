import { execFileSync, spawnSync } from "node:child_process";

/**
 * Locate the PID of the running Kindle (Amazon Lassen) main process.
 * Returns null if not running.
 */
export function findKindlePid(): number | null {
  const candidates = [
    { cmd: "pgrep", args: ["-f", "/Applications/Amazon Kindle.app/Contents/MacOS/Kindle"] },
    { cmd: "pgrep", args: ["-x", "Kindle"] },
  ];
  for (const c of candidates) {
    const res = spawnSync(c.cmd, c.args, { encoding: "utf8" });
    if (res.status === 0) {
      const first = res.stdout.trim().split("\n")[0];
      const pid = first ? parseInt(first, 10) : NaN;
      if (!Number.isNaN(pid)) return pid;
    }
  }
  return null;
}

/**
 * Return the path of the executable that is running under the given PID, or
 * null if the PID is invalid.
 */
export function pidCommandLine(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}
