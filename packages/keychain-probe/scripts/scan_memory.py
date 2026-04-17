#!/usr/bin/env python3
"""
scan-memory.py — LLDB Python script. Attach via lldb, read regions of
the Lassen process, find Ion BVMs, dump windows around hits that also
contain drm-voucher marker strings.

Usage (run from within lldb):
    (lldb) command script import scan-memory.py
    (lldb) scan_ion

Or one-shot from a shell:
    lldb -p <pid> \\
         -o "command script import scan-memory.py" \\
         -o "scan_ion" \\
         -o "quit"
"""
import lldb  # type: ignore
import os

BVM = b"\xe0\x01\x00\xea"
NEEDLES = [
    b"amzn1.drm-voucher.v1",
    b"ACCOUNT_SECRET",
    b"CLIENT_ID",
    b"atv:kin:2:",
    b"Purchase",
    b"ClippingLimit",
    b"TextToSpeechDisabled",
    b"ProtectedData",
]
# Only scan reasonable-sized regions and skip huge ones that are probably
# graphics/cache buffers.
MAX_REGION_BYTES = 512 * 1024 * 1024  # 512 MiB cap per region
DUMP_DIR = "/tmp/kindle-ion-scan"


def find_all(haystack: bytes, needle: bytes) -> list[int]:
    out: list[int] = []
    off = 0
    while True:
        i = haystack.find(needle, off)
        if i < 0:
            return out
        out.append(i)
        off = i + 1


def scan_ion(debugger, command, result, internal_dict):  # noqa: ARG001
    os.makedirs(DUMP_DIR, exist_ok=True)
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if not process.IsValid():
        result.AppendMessage("no process attached")
        return

    print(f"Target: {target}")
    print(f"Process state: {process.GetState()}")
    regions = process.GetMemoryRegions()
    n = regions.GetSize()
    print(f"Memory regions: {n}")

    error = lldb.SBError()
    total_bvms = 0
    voucher_hits: list[tuple[int, bytes, str]] = []
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
        # Skip mapped files that cannot plausibly contain decrypted data we care
        # about (libraries, text segments). We'll refine if needed.
        name = info.GetName() or ""
        if name and (name.endswith(".dylib") or name.endswith("/Kindle")):
            continue

        data = process.ReadMemory(base, size, error)
        if not error.Success():
            continue

        bvms = find_all(data, BVM)
        if not bvms:
            continue
        total_bvms += len(bvms)

        # For each BVM, check if there is a voucher marker within +-4KB.
        for bvm_off in bvms:
            win_start = max(0, bvm_off - 4096)
            win_end = min(len(data), bvm_off + 4096)
            window = data[win_start:win_end]
            hits = [n for n in NEEDLES if n in window]
            if not hits:
                continue
            # Decide the interesting slice: BVM forward 4KB
            slice_start = bvm_off
            slice_end = min(len(data), bvm_off + 4096)
            snippet = data[slice_start:slice_end]
            tag = "+".join(h.decode() for h in hits)
            key = (base + slice_start, snippet, tag)
            voucher_hits.append(key)

        if len(voucher_hits) >= 200:
            break

    print(f"Total BVMs found (across scannable regions): {total_bvms}")
    print(f"BVM windows containing voucher-ish markers: {len(voucher_hits)}")

    # Dedupe identical snippets (process may map a buffer multiple times).
    seen_hashes: set[int] = set()
    uniq: list[tuple[int, bytes, str]] = []
    for addr, snip, tag in voucher_hits:
        h = hash(snip)
        if h in seen_hashes:
            continue
        seen_hashes.add(h)
        uniq.append((addr, snip, tag))
    print(f"Unique snippets: {len(uniq)}")

    for idx, (addr, snip, tag) in enumerate(uniq[:30]):
        path = os.path.join(DUMP_DIR, f"snip-{idx:03d}-{addr:016x}.bin")
        with open(path, "wb") as f:
            f.write(snip)
        # Extract printable ASCII tokens >=4 for a readable preview
        tokens: list[str] = []
        cur: list[int] = []
        for b in snip[:1024]:
            if 0x20 <= b < 0x7f:
                cur.append(b)
            else:
                if len(cur) >= 4:
                    tokens.append(bytes(cur).decode(errors="replace"))
                cur = []
        if len(cur) >= 4:
            tokens.append(bytes(cur).decode(errors="replace"))
        preview = " | ".join(tokens[:10])
        print(f"[{idx}] addr=0x{addr:016x} tag={tag}  {path}")
        print(f"      preview: {preview[:200]}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f scan_memory.scan_ion scan_ion")
