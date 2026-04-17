#!/usr/bin/env -S node --experimental-strip-types
/**
 * Smoke test — parse all vouchers from all locally downloaded KFX books.
 * Uses @kindle/catalog to discover bundles, then @kindle/drmion to parse.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describeBundleFiles, listBooks } from "../../catalog/dist/index.js";
import { parseVoucher } from "../dist/voucher.js";

let failures = 0;
for (const book of listBooks()) {
  const files = describeBundleFiles(book.bundlePath);
  const voucherPath = files.voucher;
  if (!voucherPath) {
    console.log(`${book.asin} — no voucher found in ${book.bundlePath}`);
    continue;
  }
  const bytes = readFileSync(voucherPath);
  try {
    const parsed = parseVoucher(new Uint8Array(bytes));
    console.log(
      `${book.asin.padEnd(12)} ${book.title.slice(0, 50).padEnd(52)} ` +
        `inputs=${JSON.stringify(parsed.keyDerivationInputs)} ` +
        `cipher=${parsed.cipherSpec} mac=${parsed.macAlgorithm} ` +
        `hmac=${parsed.hmacTag.length}B ciphertext=${parsed.ciphertext.length}B`,
    );
  } catch (e) {
    failures++;
    console.error(`${book.asin} — parse failed: ${(e as Error).message}`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} voucher(s) failed to parse`);
  process.exit(1);
}
console.log("\nAll vouchers parsed successfully.");
