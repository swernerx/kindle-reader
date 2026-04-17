/**
 * Amazon DRM-Voucher (v1) parser.
 *
 * The voucher is an Amazon Ion Binary 1.0 document that wraps an encrypted
 * inner Ion document. The outer structure tells us:
 *   - the AES / HMAC algorithm spec
 *   - which named secrets (ACCOUNT_SECRET, CLIENT_ID, ...) derive the key
 *   - the HMAC-SHA256 tag
 *   - the ciphertext (an encrypted inner Ion doc)
 *
 * Amazon uses a private shared symbol table for field names, so field name
 * lookup via ion-js throws "symbol is unresolvable". The parser resolves the
 * outer struct positionally instead: the layout is fixed (observed across
 * all 5 vouchers shipping with a Lassen account on macOS; bytes 0–123 are
 * byte-identical across books).
 */
import { IonTypes, makeReader, type Reader } from "ion-js";

export type VoucherHeader = {
  /**
   * Names of secrets that need to be combined to derive the AES/HMAC key.
   * Values are looked up from somewhere outside the voucher (macOS Keychain
   * for Lassen).
   */
  keyDerivationInputs: string[];
  /** High-level algorithm family, e.g. "AES" */
  cipherFamily: string;
  /** Concrete cipher spec, e.g. "AES/CBC/PKCS5Padding" */
  cipherSpec: string;
  /** MAC algorithm, e.g. "HmacSHA256" */
  macAlgorithm: string;
  /** 32-byte HMAC tag covering algorithm-spec || ciphertext */
  hmacTag: Uint8Array;
  /** The encrypted inner Ion document */
  ciphertext: Uint8Array;
  /** Raw bytes of the outer algorithm-spec struct — exact HMAC input is TBD */
  algorithmSpecBytes: Uint8Array;
};

export class VoucherParseError extends Error {
  constructor(message: string, public readonly offset?: number) {
    super(message);
    this.name = "VoucherParseError";
  }
}

/**
 * Parse a raw .voucher byte stream into structured fields.
 *
 * The parser is resilient to Amazon's private symbol table — it does not
 * attempt to resolve field/annotation symbol IDs. Struct layout is assumed
 * to match the observed pattern.
 */
export function parseVoucher(bytes: Uint8Array): VoucherHeader {
  if (bytes.length < 4 || !isIonBvm(bytes)) {
    throw new VoucherParseError(
      `Not an Ion Binary 1.0 stream: got bytes ${bytes.slice(0, 4).toString() || "(empty)"}`,
    );
  }
  const reader = makeReader(bytes);
  if (reader.next() !== IonTypes.STRUCT) {
    throw new VoucherParseError("Outer value is not a struct");
  }
  reader.stepIn();

  const fields: { type: ReturnType<Reader["next"]>; read: () => unknown }[] = [];
  const out: Partial<VoucherHeader> = {};
  const hmacStart = 0;
  // Field 1: algorithm-spec struct
  if (reader.next() !== IonTypes.STRUCT) {
    throw new VoucherParseError("Expected algorithm-spec struct");
  }
  const algoSpec = readAlgorithmSpec(reader);
  out.keyDerivationInputs = algoSpec.keyDerivationInputs;
  out.cipherFamily = algoSpec.cipherFamily;
  out.cipherSpec = algoSpec.cipherSpec;
  out.macAlgorithm = algoSpec.macAlgorithm;
  out.algorithmSpecBytes = algoSpec.rawBytes;

  // Field 2: HMAC tag (blob, 32 bytes for HmacSHA256)
  if (reader.next() !== IonTypes.BLOB) {
    throw new VoucherParseError("Expected HMAC blob");
  }
  const hmac = reader.uInt8ArrayValue();
  if (!hmac) throw new VoucherParseError("HMAC blob is null");
  out.hmacTag = hmac;

  // Field 3: ciphertext blob
  if (reader.next() !== IonTypes.BLOB) {
    throw new VoucherParseError("Expected ciphertext blob");
  }
  const cipher = reader.uInt8ArrayValue();
  if (!cipher) throw new VoucherParseError("Ciphertext blob is null");
  out.ciphertext = cipher;

  reader.stepOut();
  // Voucher has one top-level struct; nothing more expected
  void fields;
  void hmacStart;

  return out as VoucherHeader;
}

type AlgoSpec = Pick<
  VoucherHeader,
  "keyDerivationInputs" | "cipherFamily" | "cipherSpec" | "macAlgorithm"
> & { rawBytes: Uint8Array };

function readAlgorithmSpec(reader: Reader): AlgoSpec {
  // We're positioned *on* the struct. Step into it and walk positionally.
  // Observed voucher layout:
  //   field 1: list of strings — key-derivation inputs
  //   field 2: string — cipher family (e.g. "AES")
  //   field 3: string — full cipher spec
  //   field 4: string — MAC algorithm
  reader.stepIn();
  const inputs: string[] = [];
  if (reader.next() !== IonTypes.LIST) {
    throw new VoucherParseError("algo-spec field 1 is not a list");
  }
  reader.stepIn();
  let t;
  while ((t = reader.next())) {
    if (t !== IonTypes.STRING) continue;
    const s = reader.stringValue();
    if (s) inputs.push(s);
  }
  reader.stepOut();

  const family = expectString(reader, "cipherFamily");
  const spec = expectString(reader, "cipherSpec");
  const mac = expectString(reader, "macAlgorithm");
  reader.stepOut();

  return {
    keyDerivationInputs: inputs,
    cipherFamily: family,
    cipherSpec: spec,
    macAlgorithm: mac,
    rawBytes: new Uint8Array(), // TODO: capture exact struct byte range for HMAC
  };
}

function expectString(reader: Reader, label: string): string {
  const t = reader.next();
  if (t !== IonTypes.STRING) {
    throw new VoucherParseError(`Expected string for ${label}, got ${t?.name ?? "EOF"}`);
  }
  const v = reader.stringValue();
  if (v == null) {
    throw new VoucherParseError(`${label} is null`);
  }
  return v;
}

function isIonBvm(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0xe0 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0xea
  );
}
