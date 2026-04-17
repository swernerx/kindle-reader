#!/usr/bin/env node
import { enroll, EnrollError } from "./enroll.js";
import { DEFAULT_KEYS_PATH, loadKeys } from "./keysStore.js";

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === "--help" || cmd === "-h") {
  printUsage();
  process.exit(cmd ? 0 : 2);
}

switch (cmd) {
  case "enroll":
    await runEnroll(args.slice(1));
    break;
  case "list":
    runList(args.slice(1));
    break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    printUsage();
    process.exit(2);
}

function printUsage(): void {
  console.log(`kindle-enroll — extract per-book AES keys from the running Lassen process.

usage:
  kindle-enroll enroll <asin>     extract the content key for one book
  kindle-enroll list              show enrolled books (from keys.json)

prerequisites for enroll:
  - Amazon Kindle app (com.amazon.Lassen) running
  - The target book OPEN in the reader (not just listed in the library)
  - Either SIP disabled, OR TCC "Developer Tools" permission granted to
    the terminal from which you invoke this tool.

environment:
  KINDLE_KEYS_PATH   override keys.json location (default: ${DEFAULT_KEYS_PATH})
`);
}

async function runEnroll(rest: string[]): Promise<void> {
  const asin = rest[0];
  if (!asin) {
    console.error("usage: kindle-enroll enroll <asin>");
    process.exit(2);
  }
  try {
    const result = await enroll({ asin });
    console.error(
      `\n✓ enrolled ${result.asin} — key ${result.contentKeyUuid.slice(0, 40)}... ` +
        `in ${result.elapsedSeconds.toFixed(1)}s`,
    );
  } catch (e) {
    if (e instanceof EnrollError) {
      console.error(`✗ ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

function runList(_rest: string[]): void {
  const keys = loadKeys();
  const entries = Object.entries(keys.books);
  if (entries.length === 0) {
    console.log("(no books enrolled yet — run 'kindle-enroll enroll <asin>')");
    return;
  }
  for (const [asin, bookKeys] of entries) {
    console.log(asin);
    for (const [keyUuid, k] of Object.entries(bookKeys)) {
      console.log(`  ${keyUuid}  bits=${k.bits}  extracted=${k.extractedAt}`);
    }
  }
}
