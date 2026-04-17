# Phase 2 — Keychain Probe & Voucher Analysis

## Voucher: Struktur (gesichert)

Eine `amzn1.drm-voucher.v1.<uuid>.voucher`-Datei ist **Amazon Ion Binary 1.0** (BVM `e0 01 00 ea`). Alle 5 lokal vorhandenen Voucher haben Größe **1166 Byte** und sind in den ersten **124 Bytes byte-identisch**.

### Ion-Shape (mit numerischen Feld-Symbolen, weil Amazon's Shared Symbol Table nicht im ion-js-Catalog liegt)

```
struct {
  <symId>: struct {
    <symId>: list [ "ACCOUNT_SECRET", "CLIENT_ID" ]
    <symId>: "AES"
    <symId>: "AES/CBC/PKCS5Padding"
    <symId>: "HmacSHA256"
  }
  <symId>: blob len=32   // HMAC-SHA256 tag
  <symId>: blob len=1007 // encrypted inner Ion doc (starts itself with e00100ea)
}
```

Die Annotationen sind beide Male `ProtectedData` (aus Hex-Dump erkennbar).

### Layout in Bytes (Voucher ist 1166 Byte)

| Offset | Länge | Inhalt |
|---|---|---|
| 0x00 | 4 | BVM `e0 01 00 ea` |
| 0x04 | ~120 | Ion-Struct-Header, Algorithm-Metadaten (identisch über alle Bücher) |
| 0x7c | 32 | HMAC-SHA256 (Blob) |
| 0x9c | 1010 | Encrypted inner Ion document (Blob, 1007 Byte Content + 3 Byte Length-Prefix) |

`cmp` über zwei verschiedene Voucher zeigt Unterschied ab Byte 124 — vor dem HMAC sind alle Voucher gleich (weil der Algorithmus identisch ist und die Ion-Symbol-Tabelle gleichförmig).

### Inhalt nach Entschlüsselung (erkennbar über Klartext-Strings im Raw-Dump)

Im decodierten inneren Dokument sind — teilweise schon im Wrapper erkennbar — folgende ASCII-Tokens sichtbar:

```
amzn1.drm-voucher.v1.c8d9a04c-5f1c-4ee5-b4a6-5f881c927903   (Voucher-ID)
Purchase
atv:kin:2:<base64>:<base64>                                  (ATV-Purchase-Token)
client_restrictions
ClippingLimit
TextToSpeechDisabled
false
```

Das sind klassische Kindle-License-Felder. Der eigentliche **Payload-AES-Key** liegt ebenfalls im entschlüsselten Inner Doc und ist das Zielartefakt.

### Algorithmus-Interpretation

- **Key-Derivation-Inputs**: `ACCOUNT_SECRET` + `CLIENT_ID` (beides Namen; Werte liegen **nicht** im Voucher)
- **Cipher**: `AES/CBC/PKCS5Padding` — klassisch, IV vermutlich in den ersten 16 Bytes des Ciphertext-Blobs oder separat
- **MAC**: `HmacSHA256` über (algorithm-spec || ciphertext), um Tampering zu erkennen
- **Key-Länge**: "AES" ohne Modul-Prefix deutet auf AES-128 oder AES-256 — üblicherweise AES-256 bei Amazon

### Konsequenz

Wir brauchen zwei Keychain-Werte:
1. `ACCOUNT_SECRET` (vermutlich Account-gebunden, für alle Bücher des Nutzers gleich)
2. `CLIENT_ID` (Device-gebunden — auf unserem Mac fix, ggf. identisch mit DSN aus `com.amazon.Lassen.plist`)

Mit diesen zwei Werten können wir den Voucher entschlüsseln (Phase 3), den Payload-Key extrahieren und damit die `.azw8`/`.azw9`-DRMION-Container entschlüsseln.

## Keychain-Probe

TBD — nächster Arbeitsblock. Geplante Reihenfolge:
1. `security find-generic-password -s '*' 2>&1 | grep -iE 'lassen|amazon|kindle|dsn|client'` über User-Keychain
2. `security find-generic-password -g -l <label>` für gefundene Labels (zeigt Password-Text nach User-Genehmigung)
3. Falls ACL den Zugriff verweigert: Swift-Helper in `packages/keychain-probe` mit `kSecAttrAccessGroup = "group.com.amazon.Lassen"`
4. Als Letztes: LLDB-Attach an laufende Lassen-App (Buch vorher öffnen, damit die Anti-Debug-Heuristik umgangen ist), Breakpoint auf `SecItemCopyMatching`

## Offene Fragen

- **Zählt "ACCOUNT_SECRET" auch wörtlich als Keychain-Service-Name oder als intern gerenderter Label?** Wird sich beim Probing zeigen.
- **Ist "CLIENT_ID" = DSN (`822917ABABC954D7A97CDA24790166DF`)?** Der Hex-String sieht aus wie ein MD5-Hash — typisches Device-DSN-Muster.
- **Gemeinsamer Key oder pro-Voucher?** Da die ersten 124 Byte identisch sind, ist der Key-Derivation-Mechanismus gleichförmig; der 1007-Byte-Ciphertext ist pro Buch anders. Also: derselbe Key entschlüsselt jeden Voucher (wenn er Account+Device-gebunden ist).
