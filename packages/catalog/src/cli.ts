#!/usr/bin/env node
import { describeBundleFiles, listBooks } from "./catalog.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const withMissing = args.includes("--include-missing");
const verbose = args.includes("--verbose") || args.includes("-v");

const books = listBooks(withMissing ? { includeMissing: true } : {});

if (asJson) {
  process.stdout.write(JSON.stringify(books, null, 2) + "\n");
  process.exit(0);
}

if (books.length === 0) {
  console.log("Keine lokal heruntergeladenen KFX-Bücher gefunden.");
  console.log(
    "Hinweis: BookData.sqlite enthält evtl. Mobipocket/Audible-Einträge — " +
      "die werden absichtlich ausgefiltert (nur application/x-kfx-ebook mit " +
      "Status 3 = heruntergeladen).",
  );
  process.exit(0);
}

console.log(`Gefunden: ${books.length} KFX-Buch/Bücher\n`);
for (const b of books) {
  const progressStr =
    b.progress != null ? `${(b.progress * 100).toFixed(1)}%` : "—";
  const sizeStr = b.sizeBytes
    ? `${(b.sizeBytes / 1024 / 1024).toFixed(2)} MB`
    : "?";
  console.log(`• ${b.title}`);
  console.log(`    ASIN:       ${b.asin}`);
  console.log(`    Sprache:    ${b.language ?? "?"}`);
  console.log(`    Fortschritt: ${progressStr}  (${b.currentPosition ?? "?"} / ${b.maxPosition ?? "?"})`);
  console.log(`    Größe:      ${sizeStr}`);
  console.log(`    Gelesen:    ${b.readState === 1 ? "abgeschlossen" : "offen"}`);
  console.log(`    Autor:      ${b.authorCipherHex ? "<verschlüsselt>" : "—"}`);
  console.log(`    Cover:      ${b.coverFile ?? b.coverUrl ?? "—"}`);
  console.log(`    Pfad:       ${b.bundlePath}`);
  if (verbose) {
    const files = describeBundleFiles(b.bundlePath);
    console.log(`    Bundle:`);
    console.log(`      payload (.azw8):   ${files.azw8.length}`);
    console.log(`      res     (.azw9.res): ${files.azw9Res.length}`);
    console.log(`      meta    (.azw9.md):  ${files.azw9Md.length}`);
    console.log(`      manifest (.kfx):   ${files.manifest ? "ja" : "nein"}`);
    console.log(`      voucher (.voucher): ${files.voucher ? "ja" : "nein"}`);
    console.log(`      sidecar JSON (.asc): ${files.sidecarJson.length}`);
    console.log(`      total bytes on disk: ${files.totalBytes}`);
  }
  console.log();
}
