"""
scan_keystore.py — LLDB Python script. Find all occurrences of
`amzn1.drm-key.v1.<uuid>` and `amzn1.drm-voucher.v1.<uuid>` strings in
the Kindle process memory and dump surrounding windows, so we can see
the key registry (UUID → AES key bytes).

Usage:
    lldb -p <pid> \\
         -o "command script import scan_keystore.py" \\
         -o "scan_keystore" \\
         -o "quit"
"""
import lldb  # type: ignore
import os
import re

UUID_RE = re.compile(rb"amzn1\.drm-(?:key|voucher)\.v1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
BVM = b"\xe0\x01\x00\xea"
MAX_REGION_BYTES = 512 * 1024 * 1024  # 512 MiB cap
DUMP_DIR = "/tmp/kindle-keystore"


def scan_keystore(debugger, command, result, internal_dict):  # noqa: ARG001
    os.makedirs(DUMP_DIR, exist_ok=True)
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not process.IsValid():
        result.AppendMessage("no process attached")
        return

    regions = process.GetMemoryRegions()
    n = regions.GetSize()
    error = lldb.SBError()

    # First pass: collect all (addr, uuid-string) occurrences.
    hits: dict[tuple[int, bytes], int] = {}
    total_regions_scanned = 0
    for i in range(n):
        info = lldb.SBMemoryRegionInfo()
        if not regions.GetMemoryRegionAtIndex(i, info):
            continue
        if not info.IsReadable():
            continue
        base = info.GetRegionBase()
        end = info.GetRegionEnd()
        size = end - base
        if size <= 0 or size > MAX_REGION_BYTES:
            continue
        name = info.GetName() or ""
        if name.endswith(".dylib") or name.endswith("/Kindle"):
            continue

        data = process.ReadMemory(base, size, error)
        if not error.Success():
            continue
        total_regions_scanned += 1
        for m in UUID_RE.finditer(data):
            hits[(base + m.start(), m.group())] = 1

    print(f"Regions scanned: {total_regions_scanned}")
    print(f"UUID occurrences: {len(hits)}")

    # Group by unique UUID string
    uniq_uuids: dict[bytes, list[int]] = {}
    for (addr, uid), _ in hits.items():
        uniq_uuids.setdefault(uid, []).append(addr)
    print(f"Distinct UUIDs: {len(uniq_uuids)}")
    for uid, addrs in sorted(uniq_uuids.items()):
        print(f"  {uid.decode()}  x{len(addrs)}")

    # Second pass: for each distinct UUID, dump a window at its first occurrence.
    for idx, (uid, addrs) in enumerate(sorted(uniq_uuids.items())):
        addr = sorted(addrs)[0]
        win_start = max(0, addr - 256)
        win_size = 2048
        snippet = process.ReadMemory(win_start, win_size, error)
        if not error.Success():
            continue
        safe_name = uid.decode().replace(".", "_").replace("-", "_")[:80]
        path = os.path.join(DUMP_DIR, f"uuid-{idx:03d}-{safe_name}.bin")
        with open(path, "wb") as f:
            f.write(snippet)

        # Preview printable tokens >=4 chars
        tokens = []
        cur = []
        for b in snippet[:2048]:
            if 0x20 <= b < 0x7f:
                cur.append(b)
            else:
                if len(cur) >= 4:
                    tokens.append(bytes(cur).decode(errors="replace"))
                cur = []
        if len(cur) >= 4:
            tokens.append(bytes(cur).decode(errors="replace"))
        preview = " | ".join(tokens[:12])
        print(f"[{idx}] addr=0x{addr:016x} uid={uid.decode()}")
        print(f"      file={path}")
        print(f"      preview: {preview[:240]}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f scan_keystore.scan_keystore scan_keystore")
