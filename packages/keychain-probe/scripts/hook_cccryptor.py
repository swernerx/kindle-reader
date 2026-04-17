"""
hook_cccryptor.py — LLDB script. Set a non-stopping breakpoint on
CCCryptorCreate, log every AES key/IV that passes through. Useful for
catching Lassen's per-book payload key right when it decrypts the
DRMION container.

CCCryptorCreate signature (arm64, args in x0..x6):
    x0: CCOperation  (kCCEncrypt=0, kCCDecrypt=1)
    x1: CCAlgorithm  (kCCAlgorithmAES=0, DES=1, 3DES=2, CAST=3, RC4=4, RC2=5, Blowfish=6)
    x2: CCOptions    (flags, PKCS7Padding=1, ECBMode=2)
    x3: *key
    x4:  keyLength
    x5: *iv
    x6: *cryptorRef (out)
"""
import lldb  # type: ignore
import os
import time

DUMP_DIR = "/tmp/kindle-ccrypt"
LOG_PATH = os.path.join(DUMP_DIR, "calls.log")


def _hexdump(bytes_: bytes, maxlen: int = 48) -> str:
    s = bytes_[:maxlen].hex()
    if len(bytes_) > maxlen:
        s += "..."
    return s


def bp_callback(frame, bp_loc, internal_dict):  # noqa: ARG001
    thread = frame.GetThread()
    process = thread.GetProcess()
    error = lldb.SBError()
    x0 = int(frame.FindRegister("x0").GetValue(), 0)
    x1 = int(frame.FindRegister("x1").GetValue(), 0)
    x2 = int(frame.FindRegister("x2").GetValue(), 0)
    x3 = int(frame.FindRegister("x3").GetValue(), 0)
    x4 = int(frame.FindRegister("x4").GetValue(), 0)
    x5 = int(frame.FindRegister("x5").GetValue(), 0)

    op = {0: "Encrypt", 1: "Decrypt"}.get(x0, f"Op({x0})")
    alg = {0: "AES", 1: "DES", 2: "3DES", 3: "CAST", 4: "RC4", 5: "RC2", 6: "Blowfish"}.get(x1, f"Alg({x1})")
    key = process.ReadMemory(x3, min(x4, 256), error) if x3 and x4 else b""
    iv = process.ReadMemory(x5, 16, error) if x5 else b""

    ts = time.strftime("%H:%M:%S")
    line = (
        f"{ts} op={op} alg={alg} opts={x2:#x} keylen={x4} "
        f"key={_hexdump(key)} iv={_hexdump(iv)}"
    )
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")

    # Save unique key bytes to a file for later matching
    if alg == "AES" and len(key) in (16, 24, 32):
        safe = key.hex()
        path = os.path.join(DUMP_DIR, f"aes-{x4*8}-{safe[:16]}.bin")
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(key)

    # Return False → do NOT stop the process. We just log and continue.
    return False


def hook_ccrypt(debugger, command, result, internal_dict):  # noqa: ARG001
    os.makedirs(DUMP_DIR, exist_ok=True)
    # Truncate existing log
    open(LOG_PATH, "w").close()

    target = debugger.GetSelectedTarget()
    # Set BP at CCCryptorCreate in libcommonCrypto.dylib
    bp = target.BreakpointCreateByName("CCCryptorCreate")
    if not bp.IsValid() or bp.GetNumLocations() == 0:
        print("could not resolve CCCryptorCreate symbol")
        return
    # Register Python callback; auto-continue (false stop)
    bp.SetScriptCallbackFunction("hook_cccryptor.bp_callback")
    bp.SetAutoContinue(True)
    print(f"CCCryptorCreate hook installed: {bp.GetNumLocations()} location(s)")
    print(f"logging to {LOG_PATH}")


def __lldb_init_module(debugger, internal_dict):  # noqa: ARG001
    debugger.HandleCommand("command script add -f hook_cccryptor.hook_ccrypt hook_ccrypt")
