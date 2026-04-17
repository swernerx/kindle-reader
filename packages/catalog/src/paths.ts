import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Lassen's sandbox root. ZPATH values in BookData.sqlite are relative to this
 * (they start with "Library/eBooks/...").
 */
const SANDBOX = join(homedir(), "Library/Containers/com.amazon.Lassen/Data");
const LIB = join(SANDBOX, "Library");

export const LASSEN_PATHS = {
  sandbox: SANDBOX,
  library: LIB,
  bookDataDb: join(LIB, "Protected/BookData.sqlite"),
  ksdkAssetDb: join(LIB, "KSDK/ksdk.asset.db"),
  eBooks: join(LIB, "eBooks"),
  coversCache: join(LIB, "Caches/covers"),
} as const;
