# Bestandsaufnahme — Lassen-Container auf macOS

> Ergebnis des ersten Explore-Agenten (2026-04-17). Alle Pfade sind read-only inspiziert. Keine Datei wurde modifiziert.

## Bücher-Verzeichnis

Pfad: `~/Library/Containers/com.amazon.Lassen/Data/Library/eBooks/<ASIN>/<UUID>/`

Gefunden: **5 Bücher**, alle heruntergeladen:

| ASIN | UUID | Bekannt als |
|---|---|---|
| B07MCZSP7M | 4B894634-9DCF-43A0-8C56-23DEA9936177 | Inspired: How to Create Tech Products Customers Love |
| B0090RVGW0 | A9473A0A-A94B-497D-994F-94005189941D | On Writing Well, 30th Anniversary Edition |
| B0C1JLM56Z | 70F1F9B9-478B-40DB-81D5-8B8027E5A0ED | 12 Gesetze der Dummheit |
| B005VPXXVM | F9D425BE-3846-46E1-87BA-91E1CA131D91 | I Was Blind But Now I See |
| B00M1JLEBC | 833A2895-8277-43ED-84CC-661483288FC2 | Hooked: Wie Sie Produkte erschaffen, die süchtig machen |

### Dateitypen pro Buch

| Datei | Größe (Beispiel B07MCZSP7M) | Header (erste Bytes) | Interpretation |
|---|---|---|---|
| `CR!*.azw8` | 266 460 B | `ea 44 52 4d 49 4f 4e ee` (`DRMION` + Marker) | verschlüsselter Haupt-Payload |
| `CR!*.azw9.res` | 46 679 B | `43 4f 4e 54` (`CONT`) oder `DRMION` | Ressourcen (Bilder, CSS, ggf. Fonts) |
| `CR!*.azw9.md` | 214 847 B | `CONT` oder `DRMION` | Metadaten-Container |
| `BookManifest.kfx` | 28 672 B | `53 51 4c 69 74 65` (`SQLite`) | Unverschlüsselte SQLite-DB, Manifest & Index |
| `StartActions.data.<ASIN>.asc` | 51 084 B | — | **Klartext-JSON** mit Buch-Infos (ASIN, Cover-URL, Rating, …) |
| `EndActions.data.<ASIN>.asc` | 29 737 B | — | **Klartext-JSON**, analog |
| `XRAY.entities.<ASIN>.asc` | — | — | **Klartext**, X-Ray-Daten |
| `amzn1.drm-voucher.v1.*.voucher` | 1 166 B | `e0 01 00 ea` (Ion-ähnliches Binary) | bplist-artiger DRM-Voucher mit `ACCOUNT_SECRET`, `CLIENT_ID`, Algorithmus-String `AES/CBC/PKCS5Padding`, `HmacSHA256` |

## Metadaten-Quellen (read-only, DB)

| Pfad | Inhalt |
|---|---|
| `~/Library/Containers/com.amazon.Lassen/Data/Library/Protected/BookData.sqlite` | Zentrale Buch-DB. Tabelle `ZBOOK`: `ZBOOKID`, `ZDISPLAYTITLE` (plain), `ZDISPLAYAUTHOR` (BLOB, offenbar verschlüsselt), `ZPATH`, `ZRAWFILESIZE`, `ZRAWISENCRYPTED`, `ZRAWCURRENTPOSITION`, `ZRAWMAXPOSITION`, `ZRAWREADSTATE` |
| `~/Library/Containers/com.amazon.Lassen/Data/Library/KSDK/ksdk.asset.db` | Tabelle `Nodes`: `ASIN`, `TITLE`, `AUTHORS` (teils plain), `THUMBNAIL` (Pfad), `DOWNLOAD_STATE`, `ENCRYPT`, `TOTAL_POSITION` |
| `~/Library/Containers/com.amazon.Lassen/Data/Library/LocalCollection.sqlite` | Lokale Sammlungen/Tags |
| `~/Library/Containers/com.amazon.Lassen/Data/Library/AnnotationStorage` | Annotationen (Highlights, Notizen) |
| `~/Library/Containers/com.amazon.Lassen/Data/Library/Application Support/Whispersync/WSyncDefault.sqlite` | Sync-State, Fortschritt über Geräte |
| `~/Library/Containers/com.amazon.Lassen/Data/Library/Caches/covers/*.png` | **Cover-Bilder unverschlüsselt als PNG** (Dateinamen sind Hashes) |

Hinweis: SQLite-DBs haben `-wal`/`-shm`-Sidecars (Live-App). Für Zugriff: Dateien als Gruppe nach `/tmp` kopieren oder im Read-only-Mode mit URI-Flags öffnen.

## Schlüsselmaterial

- **Nicht** als File im Container gefunden. Keine `*.key`, `*.pem`, `*.der`.
- Device-IDs (DSN, directedId, deviceType, marketplaceId) in `~/Library/Containers/com.amazon.Lassen/Data/Library/Preferences/com.amazon.Lassen.plist` (bplist, plain).
- Arbeitshypothese (bestätigt durch Anatoly-iOS-RE an der baugleichen App): Keys in der **macOS-Keychain** unter `group.com.amazon.Lassen`. DRM-Voucher-Felder `ACCOUNT_SECRET` + `CLIENT_ID` vermutlich Payload-Key-Ableitung.

## Classic Kindle-App

**Nicht vorhanden**. Kein `~/Library/Containers/com.amazon.Kindle/`, kein `~/Documents/My Kindle Content/`. Der klassische DeDRM-Weg mit K4Mac 1.x ist auf diesem Gerät nicht gangbar — Neuinstallation wäre theoretisch möglich, aber Amazon hat den alten Download-Endpoint 2025 abgeschaltet.

## Zusammenfassung — was heißt das für die Roadmap

- **Phase 1 (Katalog)** ist sofort machbar: Titel + Cover + Fortschritt aus SQLite + PNG-Caches.
- **Phase 2 (Keychain-Probe)** ist das Gate: Zugriff auf `group.com.amazon.Lassen`-Items.
- **Phase 3 (DRMION)** sobald Key + Voucher-Parser zusammenspielen.
- **Phase 4 (KFX)** mit `ion-js` gegen entschlüsselten Klartext.

---

Detaillierter Evidenz-Dump (Hex-Samples, exakte DB-Schemas, Voucher-Struktur) ist im ursprünglichen Explore-Agent-Output enthalten und hier redigiert zusammengefasst.
