"""
dump_small.py — LLDB script. Dump only small writable memory regions
(heap-ish, where AES keys are likely to live) to /tmp/kindle-brute/small.bin.
"""
import lldb  # type: ignore
import os

DUMP_DIR = "/tmp/kindle-brute"
MAX_REGION = 4 * 1024 * 1024  # 4 MiB max per region
MIN_REGION = 4 * 1024         # 4 KiB min


def dump_small(debugger, command, result, internal_dict):  # noqa: ARG001
    os.makedirs(DUMP_DIR, exist_ok=True)
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    regions = process.GetMemoryRegions()
    n = regions.GetSize()
    error = lldb.SBError()

    out_path = os.path.join(DUMP_DIR, "small.bin")
    index_path = os.path.join(DUMP_DIR, "small.index")
    total = 0
    kept = 0
    with open(out_path, "wb") as out, open(index_path, "w") as idx:
        for i in range(n):
            info = lldb.SBMemoryRegionInfo()
            if not regions.GetMemoryRegionAtIndex(i, info):
                continue
            if not info.IsReadable() or not info.IsWritable():
                continue
            base = info.GetRegionBase()
            end = info.GetRegionEnd()
            size = end - base
            if size < MIN_REGION or size > MAX_REGION:
                continue
            name = info.GetName() or ""
            data = process.ReadMemory(base, size, error)
            if not error.Success():
                continue
            # Dump in the concatenated file, indexed by (file_offset, base, size)
            idx.write(f"{total:012x} {base:016x} {size} {name}\n")
            out.write(data)
            total += size
            kept += 1

    print(f"kept {kept} small regions, total {total/1024/1024:.1f} MiB -> {out_path}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f dump_small.dump_small dump_small")
