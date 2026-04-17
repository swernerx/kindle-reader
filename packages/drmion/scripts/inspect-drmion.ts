#!/usr/bin/env -S node --experimental-strip-types
/**
 * One-shot exploration script: parse a .azw8 / .azw9.res / .azw9.md file.
 * The on-disk layout is:
 *   - 8 bytes of DRMION magic: "\xeaDRMION\xee"
 *   - Ion Binary 1.0 stream with: unencrypted metadata, encrypted data blobs, IVs, signatures
 */
import { readFileSync } from "node:fs";
import { IonTypes, makeReader, type Reader } from "ion-js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node inspect-drmion.ts <path-to-azw8-or-res-or-md>");
  process.exit(1);
}

const bytes = readFileSync(path);
console.log(`file:   ${path}`);
console.log(`size:   ${bytes.length} bytes`);
console.log(`header: ${bytes.subarray(0, 8).toString("hex")}  (expected: ea44524d494f4eee = "DRMION" + 0xee)`);
if (!bytes.subarray(0, 8).equals(Buffer.from("ea44524d494f4eee", "hex"))) {
  console.warn("warning: unexpected header");
}

// Parse Ion stream starting at offset 8
const ion = new Uint8Array(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
console.log(`\nIon stream starts at offset 8, ${ion.length} bytes\n`);

const reader = makeReader(ion);

function safe<T>(fn: () => T, fallback: string): T | string {
  try { return fn(); } catch (e) { return `${fallback}<${(e as Error).message}>`; }
}

let nodeCount = 0;
function walk(r: Reader, depth: number) {
  const indent = "  ".repeat(depth);
  let type;
  while ((type = r.next())) {
    if (nodeCount++ > 500) {
      console.log(`${indent}... truncated at 500 nodes`);
      return;
    }
    const ann = safe(() => r.annotations(), "?ann");
    const annStr = Array.isArray(ann) && ann.length ? `[${ann.join(",")}] ` : "";
    const fname = safe(() => r.fieldName(), "?f");
    const fnameStr = fname ? `${fname}: ` : "";
    const prefix = `${indent}${fnameStr}${annStr}${type.name}`;

    if (type === IonTypes.STRUCT || type === IonTypes.LIST || type === IonTypes.SEXP) {
      const open = type === IonTypes.STRUCT ? "{" : "[";
      const close = type === IonTypes.STRUCT ? "}" : "]";
      console.log(`${prefix} ${open}`);
      r.stepIn();
      walk(r, depth + 1);
      r.stepOut();
      console.log(`${indent}${close}`);
    } else if (type === IonTypes.STRING) {
      const s = r.stringValue();
      const show = s && s.length > 100 ? s.slice(0, 100) + "…" : s;
      console.log(`${prefix} = ${JSON.stringify(show)}`);
    } else if (type === IonTypes.SYMBOL) {
      const s = safe(() => r.stringValue(), "?s");
      console.log(`${prefix} = ${typeof s === "string" ? JSON.stringify(s) : s}`);
    } else if (type === IonTypes.INT) {
      console.log(`${prefix} = ${r.numberValue()}`);
    } else if (type === IonTypes.BOOL) {
      console.log(`${prefix} = ${r.booleanValue()}`);
    } else if (type === IonTypes.BLOB || type === IonTypes.CLOB) {
      const buf = r.uInt8ArrayValue();
      if (!buf) { console.log(`${prefix} = null`); continue; }
      const h = Buffer.from(buf).toString("hex");
      console.log(`${prefix} = <bytes len=${buf.length} hex=${h.slice(0, 64)}${h.length > 64 ? "..." : ""}>`);
    } else if (type === IonTypes.NULL) {
      console.log(`${prefix} = null`);
    } else if (type === IonTypes.TIMESTAMP) {
      console.log(`${prefix} = ${r.timestampValue()?.toString() ?? "null"}`);
    } else {
      console.log(prefix);
    }
  }
}

try {
  walk(reader, 0);
} catch (e) {
  console.error(`\nparse stopped at node ${nodeCount}: ${(e as Error).message}`);
}
