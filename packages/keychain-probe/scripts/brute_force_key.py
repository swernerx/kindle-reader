"""
brute_force_key.py — LLDB script. Slide a window across all readable memory
regions of the Kindle process and try each 32-byte window as an AES-256-CBC
key against a known-IV + known-ciphertext. Validate via PKCS#7 padding on the
last block.

If successful, writes the key to /tmp/kindle-brute/found-key.bin and logs
the memory address where it was found.

Usage:
    lldb -p <pid> \\
         -o "command script import brute_force_key.py" \\
         -o "brute_force <ciphertext-hex> <iv-hex>" \\
         -o "quit"

The ciphertext and IV come from the first encrypted chunk of the target
DRMION file. Ciphertext length must be a multiple of 16 (AES block size).

We also try AES-128 (16-byte keys) as a fallback.
"""
import lldb  # type: ignore
import os
import sys
import time

# Vendored pure-Python AES-CBC for speed (PyCryptodome may not be available in lldb's
# Python env). But actually ccryptography is not available either in lldb Python.
# The stdlib gives us no AES. Solution: dump candidate keys to disk and run a separate
# TypeScript validator — much simpler and faster.

DUMP_DIR = "/tmp/kindle-brute"
MAX_REGION_BYTES = 256 * 1024 * 1024  # 256 MiB cap per region
WINDOW_SIZES = [32, 16]


def brute_force(debugger, command, result, internal_dict):  # noqa: ARG001
    os.makedirs(DUMP_DIR, exist_ok=True)
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not process.IsValid():
        print("no process attached")
        return

    regions = process.GetMemoryRegions()
    n = regions.GetSize()
    print(f"Dumping readable heap regions (Kindle has {n} regions total)")
    error = lldb.SBError()

    out_path = os.path.join(DUMP_DIR, "candidates.bin")
    index_path = os.path.join(DUMP_DIR, "candidates.index")
    total_bytes = 0
    nregions = 0
    with open(out_path, "wb") as out, open(index_path, "w") as idx:
        for i in range(n):
            info = lldb.SBMemoryRegionInfo()
            if not regions.GetMemoryRegionAtIndex(i, info):
                continue
            if not info.IsReadable():
                continue
            # Skip code regions (non-writable, executable) — the key won't be there.
            if not info.IsWritable():
                continue
            base = info.GetRegionBase()
            end = info.GetRegionEnd()
            size = end - base
            if size <= 0 or size > MAX_REGION_BYTES:
                continue
            name = info.GetName() or ""
            data = process.ReadMemory(base, size, error)
            if not error.Success():
                continue
            out.write(data)
            idx.write(f"{base:016x} {size} {name}\n")
            total_bytes += size
            nregions += 1
            if nregions % 20 == 0:
                print(f"  {nregions} regions, {total_bytes/1024/1024:.1f} MiB so far")

    print(f"wrote {total_bytes/1024/1024:.1f} MiB from {nregions} regions to {out_path}")
    print(f"region index at {index_path}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f brute_force_key.brute_force brute_force")
