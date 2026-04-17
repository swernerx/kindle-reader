# @kindle/catalog

Listet die lokal heruntergeladenen KFX-Bücher aus der Lassen-App auf macOS.

## CLI

```
# kompakte Liste
pnpm --filter @kindle/catalog start

# mit Bundle-Inventar (Payload/Res/MD/Voucher/Manifest)
pnpm --filter @kindle/catalog start -- --verbose

# JSON
pnpm --filter @kindle/catalog start -- --json

# auch Einträge, deren Bundle nicht auf der Platte liegt
pnpm --filter @kindle/catalog start -- --include-missing
```

## Scope

Liefert ausschließlich Bücher mit:
- `ZMIMETYPE = 'application/x-kfx-ebook'`
- `ZRAWBOOKSTATE = 3` (heruntergeladen)
- Bundle-Verzeichnis existiert auf der Platte

Der Lassen-Store enthält darüber hinaus Mobipocket-Altbestand (Instapaper-Exporte) und Audible-Platzhalter — beides wird absichtlich ausgefiltert.

## Felder (BookEntry)

| Feld | Quelle | Hinweis |
|---|---|---|
| `bookId` | ZBOOK.ZBOOKID | Form `A:<ASIN>-0` |
| `asin` | abgeleitet | — |
| `title` | ZBOOK.ZDISPLAYTITLE | Klartext |
| `authorCipherHex` | ZBOOK.ZDISPLAYAUTHOR (BLOB) | AES-CBC-Ciphertext; Decoding in Phase 3 |
| `bundlePath` | `Data/` + ZBOOK.ZPATH | enthält `.azw8`, `.azw9.res`, `.azw9.md`, `BookManifest.kfx`, `*.voucher`, `*.asc` |
| `sizeBytes` | ZBOOK.ZRAWFILESIZE | — |
| `progress` | currentPosition / maxPosition | 0..1 |
| `readState` | ZBOOK.ZRAWREADSTATE | 0=offen, 1=abgeschlossen |
| `dbEncryptedFlag` | ZBOOK.ZRAWISENCRYPTED | evtl. stale, verlässlicher ist der DRMION-Header der Dateien selbst |
| `coverFile` | Caches/covers/*.png | Hash-basierter Dateiname, ASIN-Match |
| `coverUrl` | StartActions.data.<ASIN>.asc → bookInfo.imageUrl | Fallback, wenn lokales PNG fehlt |

## Sicherheit

- DBs werden vor Lesezugriff nach `os.tmpdir()` kopiert (WAL/SHM mit), Original bleibt unangetastet.
- Read-only Open via `better-sqlite3`.
- Kein Write auf den Lassen-Container.
