"""
scan_region.py — LLDB Python script. Read a large window around a given
address and dump to disk for offline Ion inspection.
"""
import lldb  # type: ignore
import os


def dump_region(debugger, command, result, internal_dict):  # noqa: ARG001
    args = command.split()
    if len(args) < 2:
        print("usage: dump_region <hex-addr> <size-bytes>")
        return
    addr = int(args[0], 16)
    size = int(args[1], 0)

    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    error = lldb.SBError()
    data = process.ReadMemory(addr, size, error)
    if not error.Success():
        print(f"read failed: {error}")
        return

    out_dir = "/tmp/kindle-region"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"region-{addr:016x}-{size:x}.bin")
    with open(path, "wb") as f:
        f.write(data)
    print(f"wrote {size} bytes to {path}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f scan_region.dump_region dump_region")
