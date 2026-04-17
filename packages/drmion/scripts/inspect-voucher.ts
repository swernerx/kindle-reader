#!/usr/bin/env -S node --experimental-strip-types
/**
 * One-shot exploration script: dump the Ion structure of a drm-voucher file.
 * Amazon uses a custom shared symbol table that ion-js does not know about,
 * so `annotations()` / `fieldName()` may throw "symbol is unresolvable".
 * We swallow those errors and show numeric symbol IDs instead so we can
 * learn the shape before providing a catalog.
 */
import { readFileSync } from "node:fs";
import { makeReader, IonTypes } from "ion-js";

const voucherPath = process.argv[2];
if (!voucherPath) {
  console.error("usage: node inspect-voucher.ts <path-to-voucher-file>");
  process.exit(1);
}

const bytes = readFileSync(voucherPath);
console.log(`file: ${voucherPath}`);
console.log(`size: ${bytes.length} bytes`);
console.log(`header: ${bytes.slice(0, 4).toString("hex")}  (BVM = e00100ea → Ion 1.0)`);
console.log();

const reader = makeReader(new Uint8Array(bytes));

function safe<T>(fn: () => T, fallback: string): T | string {
  try {
    return fn();
  } catch (e) {
    return `${fallback}<${(e as Error).message}>`;
  }
}

function walk(depth: number) {
  const indent = "  ".repeat(depth);
  let type;
  while ((type = reader.next())) {
    const ann = safe(() => reader.annotations(), "?annotations");
    const annStr = Array.isArray(ann) && ann.length ? `[${ann.join(",")}] ` : "";
    const name = safe(() => reader.fieldName(), "?field");
    const prefix = `${indent}${name ? `${name}: ` : ""}${annStr}${type.name}`;
    if (
      type === IonTypes.STRUCT ||
      type === IonTypes.LIST ||
      type === IonTypes.SEXP
    ) {
      const open = type === IonTypes.STRUCT ? "{" : "[";
      const close = type === IonTypes.STRUCT ? "}" : "]";
      console.log(`${prefix} ${open}`);
      reader.stepIn();
      walk(depth + 1);
      reader.stepOut();
      console.log(`${indent}${close}`);
    } else if (type === IonTypes.STRING) {
      console.log(`${prefix} = ${JSON.stringify(reader.stringValue())}`);
    } else if (type === IonTypes.SYMBOL) {
      const str = safe(() => reader.stringValue(), "?sym");
      console.log(`${prefix} = ${typeof str === "string" ? JSON.stringify(str) : str}`);
    } else if (type === IonTypes.INT) {
      console.log(`${prefix} = ${reader.numberValue()}`);
    } else if (type === IonTypes.BOOL) {
      console.log(`${prefix} = ${reader.booleanValue()}`);
    } else if (type === IonTypes.BLOB || type === IonTypes.CLOB) {
      const buf = reader.uInt8ArrayValue();
      if (!buf) {
        console.log(`${prefix} = null`);
      } else {
        const hex = Buffer.from(buf).toString("hex");
        console.log(
          `${prefix} = <bytes len=${buf.length} hex=${hex.slice(0, 80)}${hex.length > 80 ? "..." : ""}>`,
        );
      }
    } else if (type === IonTypes.NULL) {
      console.log(`${prefix} = null`);
    } else if (type === IonTypes.TIMESTAMP) {
      console.log(`${prefix} = ${reader.timestampValue()?.toString() ?? "null"}`);
    } else {
      console.log(prefix);
    }
  }
}

walk(0);

console.log("\n--- printable ASCII tokens (>=4 chars) ---");
const printable = Array.from(
  bytes.toString("binary").matchAll(/[\x20-\x7e]{4,}/g),
).map((m) => m[0]);
for (const s of printable) console.log(`  ${s}`);
