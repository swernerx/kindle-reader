/**
 * Walk the Ion stream of a .azw8/.azw9.res/.azw9.md file and extract the
 * first N (ciphertext, iv) pairs. Use these as the known-ciphertext input
 * for the brute-force key search.
 *
 * The DRMION wire format observed on disk:
 *   - 8-byte magic: 0xea "DRMION" 0xee
 *   - Ion Binary 1.0 stream, one or more top-level lists
 *   - Each list = [ metadata-struct, (ciphertext-blob, iv-blob)*, signature-blob ]
 *
 * The metadata struct carries (in this order, positionally):
 *   - int: chunk size (typically 102400)
 *   - int: sub-chunk size (typically 10240)
 *   - string: content-key UUID ("amzn1.drm-key.v1.<uuid>")
 *   - string: cipher spec ("AES/CBC/PKCS5Padding")
 *   - string: voucher UUID ("amzn1.drm-voucher.v1.<uuid>")
 *   - string: signature-key UUID ("amzn1.drm-key.v1.<uuid>")
 *   - string: signature algorithm ("SHA256withRSA")
 *   - string: voucher UUID (repeated)
 *   - string: compression ("LZMA")
 */
import { readFileSync } from "node:fs";
import { IonTypes, makeReader, type Reader } from "ion-js";

export const DRMION_MAGIC = Buffer.from("ea44524d494f4eee", "hex");

export type ChunkPair = {
  ciphertext: Uint8Array;
  iv: Uint8Array;
};

export type DrmionMetadata = {
  chunkSize: number;
  subChunkSize: number;
  contentKeyUuid: string;
  cipherSpec: string;
  voucherUuid: string;
  signatureKeyUuid: string;
  signatureAlgorithm: string;
  compression: string;
};

export type DrmionView = {
  metadata: DrmionMetadata;
  /** Encrypted (ciphertext, iv) pairs in file order. */
  pairs: ChunkPair[];
};

export function readDrmionFile(path: string, maxPairs?: number): DrmionView {
  const bytes = readFileSync(path);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(DRMION_MAGIC)) {
    throw new Error(`not a DRMION file (magic mismatch): ${path}`);
  }
  const ion = new Uint8Array(bytes.buffer, bytes.byteOffset + 8, bytes.length - 8);
  const reader = makeReader(ion);

  let metadata: DrmionMetadata | undefined;
  const pairs: ChunkPair[] = [];

  while (reader.next()) {
    if (reader.type() !== IonTypes.LIST) continue;
    reader.stepIn();
    let structIdx = 0;
    while (reader.next()) {
      if (reader.type() !== IonTypes.STRUCT) continue;
      if (structIdx === 0) {
        // metadata struct — only read on the first occurrence
        if (!metadata) metadata = readMetadata(reader);
        else skipStruct(reader);
        structIdx++;
        continue;
      }
      const pair = readChunkPair(reader);
      if (pair) pairs.push(pair);
      if (maxPairs !== undefined && pairs.length >= maxPairs) break;
      structIdx++;
    }
    reader.stepOut();
    if (maxPairs !== undefined && pairs.length >= maxPairs) break;
  }

  if (!metadata) throw new Error(`no metadata struct found in ${path}`);
  return { metadata, pairs };
}

function readMetadata(reader: Reader): DrmionMetadata {
  reader.stepIn();
  const ints: number[] = [];
  const strs: string[] = [];
  let t;
  while ((t = reader.next())) {
    if (t === IonTypes.INT) ints.push(reader.numberValue() ?? 0);
    else if (t === IonTypes.STRING) strs.push(reader.stringValue() ?? "");
  }
  reader.stepOut();
  const [chunkSize = 0, subChunkSize = 0] = ints;
  const [contentKeyUuid = "", cipherSpec = "", voucherUuid = "", signatureKeyUuid = "", signatureAlgorithm = "", , compression = ""] = strs;
  return {
    chunkSize,
    subChunkSize,
    contentKeyUuid,
    cipherSpec,
    voucherUuid,
    signatureKeyUuid,
    signatureAlgorithm,
    compression,
  };
}

function readChunkPair(reader: Reader): ChunkPair | null {
  reader.stepIn();
  const blobs: Uint8Array[] = [];
  let t;
  while ((t = reader.next())) {
    if (t === IonTypes.BLOB) {
      const v = reader.uInt8ArrayValue();
      if (v) blobs.push(v);
    }
  }
  reader.stepOut();
  if (blobs.length < 2) return null;
  const iv = blobs.find((b) => b.length === 16);
  const ciphertext = blobs.find((b) => b.length !== 16 && b.length % 16 === 0);
  if (!iv || !ciphertext) return null;
  return { iv, ciphertext };
}

function skipStruct(reader: Reader): void {
  reader.stepIn();
  while (reader.next()) {
    // drain
  }
  reader.stepOut();
}
