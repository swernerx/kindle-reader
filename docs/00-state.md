# Live Status

> Diese Datei wird **nach jedem substanziellen Arbeitsblock** aktualisiert. Sie ist die einzige "lebende" Doku — phasenspezifische Notizen landen in den jeweiligen `NN-*.md`-Dateien.

## Aktueller Stand

**Phase**: 2b abgeschlossen, Phase 3 Start
**Ampel**: 🟢
**Lassen-Version (referenziert)**: 7.56, Build 1.430240.10
**macOS**: Darwin 25.3.0 (Tahoe-Zeitraum)
**SIP**: deaktiviert (Nutzerangabe)

## Letzter Schritt

**Phase 2b — Content-Key extrahiert!** 🎯. Für "On Writing Well" (ASIN B0090RVGW0) ist die AES-128-Key-bytesequenz für `amzn1.drm-key.v1.b0aec2ee-f4d6-4d4b-a19f-cd8903e52739` = **`a931438314febc3641495ec212eae24d`** (im Memory-Dump bei Offset 0x7ad2710).

Weg: LLDB an laufenden Lassen-Prozess (PID 3948, Buch offen) → writeable Regionen < 4 MiB dumpen (235 MiB) → Offline-Brute-Force mit 5 simultanen (Ciphertext, IV)-Paaren aus der `.azw8`, PKCS7-Padding-Validation auf allen. Einziger Treffer = echter Key.

End-to-end Verifikation (alle 5 Chunks dekrypted + LZMA-alone-dekomprimiert zu je 10240 Bytes, Chunk 0 beginnt mit "CONT" Header) ✓.

**Erkenntnisse zur DRMION-Struktur**:
- File-Header: 8 Bytes `ea 44 52 4d 49 4f 4e ee`
- Ion-Stream: Liste von [Metadaten-Struct, (Ciphertext, IV) × N, Signatur]
- Pro Chunk: AES-128-CBC-PKCS5 + LZMA-alone (Props=0x5D, Dict=4 MiB, Uncompressed-Länge=10240)
- Metadata enthält `amzn1.drm-key.v1.<uuid>` für Content-Key und Signature-Key, sowie `amzn1.drm-voucher.v1.<uuid>`, "AES/CBC/PKCS5Padding", "SHA256withRSA", "LZMA".

**Phase 2a** ✓. Voucher-Parser (1166B disk-format).

**Phase 1** ✓. Catalog listet alle 5 KFX-Bücher.

Stichprobe aus Live-Run:

| Buch | Fortschritt | Größe |
|---|---|---|
| 12 Gesetze der Dummheit | 68,9 % | 2,62 MB |
| Hooked | 87,1 % | 3,27 MB |
| I Was Blind But Now I See | 2,7 % | 0,58 MB |
| Inspired | 36,8 % | 0,56 MB |
| On Writing Well | 92,6 % | 2,50 MB |

Autor-Feld bleibt `<verschlüsselt>`, bis Phase 2/3 den Key liefern.

## Scope-Einschränkung (Nutzer-Klarstellung 2026-04-17)

- Nur `ZMIMETYPE = 'application/x-kfx-ebook'` + `ZRAWBOOKSTATE = 3` → die 5 KFX-Bücher.
- Mobipocket (`application/x-mobipocket-ebook`) = alte Instapaper-Exporte, irrelevant.
- Audible (`audio/audible`) = Begleit-Audiobuch, nicht Extraktionsziel.

## Beobachtungen aus DB

- `ZDISPLAYTITLE` ist Klartext-Varchar.
- `ZDISPLAYAUTHOR` ist **verschlüsseltes BLOB** (16/32/64 Byte AES-CBC-Ciphertext). Key liegt in derselben Quelle wie für die Buchpayloads — Katalog zeigt Autor als `<verschlüsselt>`, bis Phase 2 den Key liefert.
- `ZPATH` verweist relativ auf `Library/eBooks/<ASIN>/<UUID>`.
- Fortschritt: `ZRAWCURRENTPOSITION` / `ZRAWMAXPOSITION` (beide plain Integer).

## Nächster Schritt

**Phase 3 — DRMION-Entschlüsselungs-Paket**. Baue `@kindle/drmion` zu einem voll brauchbaren Modul aus:
- `parseDrmion(bytes)` → strukturierter Container (Metadaten, verschlüsselte Chunks)
- `decryptAndDecompressChunk(chunk, key)` → Raw-Plaintext
- `decryptBook(bundlePath, key)` → alle Chunks zu einem Ion-Stream verknüpft

Key-Source: zunächst File-basiert (`~/.config/kindle-extractor/keys.json` mit `uuid → hex`). Später eventuell automatisches Memory-Extrakt-Workflow für die anderen 4 Bücher.

**Nachgelagert**: Keys für die anderen 4 Bücher per LLDB-Memory-Dump extrahieren (Nutzer muss jeweils das Buch öffnen, ich dump + brute-force). Erst aber die Pipeline für OWW end-to-end fertigstellen.

**Hinweis zu LLDB-Attach** (Nutzer-Tip): Die Kindle-App hat ein Anti-Debug-Verhalten, das beim Kaltstart zu Abstürzen führt. Stabil wird der Attach erst **nach Öffnen eines Buches**. Wenn wir LLDB brauchen, folgen wir dieser Reihenfolge: Lassen starten → Buch öffnen → `lldb -p <pid>`.

## Blocker

Keine.

## Erkannte Bücher (Snapshot)

| ASIN | Titel (aus BookData.sqlite) | Größe | Fortschritt |
|---|---|---|---|
| B07MCZSP7M | Inspired: How to Create Tech Products Customers Love | 475 KB | ~37 % |
| B0090RVGW0 | On Writing Well (30th Anniv.) | — | — |
| B0C1JLM56Z | 12 Gesetze der Dummheit | — | — |
| B005VPXXVM | I Was Blind But Now I See | — | — |
| B00M1JLEBC | Hooked: Wie Sie Produkte erschaffen, die süchtig machen | — | — |

Vollständige Angaben nach Phase 1.

## Verlauf

- **2026-04-17** — Explore-Phase abgeschlossen (drei parallele Agenten: Dateisystem, Tool-Recherche, UI-OCR-Fallback). Plan mit Decision-Gates finalisiert und genehmigt. RE-Pfad gewählt (Keychain → DRMION → KFX → Markdown/ePub). Strikt on-device, keine LLM-APIs.
- **2026-04-17** — Phase 0 abgeschlossen: pnpm-Monorepo, Doku-Skelett, Agent-Reports als Anhang in `docs/`.
- **2026-04-17** — Phase 1 abgeschlossen: `@kindle/catalog` liest BookData.sqlite + KSDK-DB, listet 5 KFX-Bücher mit Titel/Progress/Cover. Nutzer-Scope geklärt: nur KFX, keine Mobipocket/Audible-Reste.
- **2026-04-17** — Phase 2 gestartet: Keychain-Probe + Voucher-Analyse. Erkenntnis: Lassen ist Mac-Catalyst-Build (`arm64-apple-ios-macabi`, Entitlement `keychain-access-groups = J7P34ALZ5R.com.amazon.Lassen`).
- **2026-04-17** — Ad-hoc-signierte Swift-CLI mit passenden Entitlements wurde von `securityd` silent abgewiesen (Hang in Kernel-Wait). Pivot auf **In-Process-Extraktion per LLDB**.
- **2026-04-17** — LLDB-Attach funktioniert (SIP off + get-task-allow=false ist hier kein Blocker, AMFI permissive für Drittanbieter-Apps). Memory-Scan findet Ion-BVMs, decrypt-ten Voucher und Key-Registry-Strukturen. Alle 5 Bücher teilen sich dasselbe Buch-Symbol-Dictionary + voucher-uuid-format.
- **2026-04-17** — **Content-Key gefunden** per Known-Plaintext-Brute-Force (5 Chunks gleichzeitig + PKCS7). AES-128-CBC, LZMA-alone-Kompression, 10240-Byte Sub-Chunks. End-to-end verifiziert.
