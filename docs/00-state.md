# Live Status

> Diese Datei wird **nach jedem substanziellen Arbeitsblock** aktualisiert. Sie ist die einzige "lebende" Doku — phasenspezifische Notizen landen in den jeweiligen `NN-*.md`-Dateien.

## Aktueller Stand

**Phase**: 2 — Keychain-Probe (Start)
**Ampel**: 🟢
**Lassen-Version (referenziert)**: 7.56, Build 1.430240.10
**macOS**: Darwin 25.3.0 (Tahoe-Zeitraum)
**SIP**: deaktiviert (Nutzerangabe)

## Letzter Schritt

**Phase 1 abgeschlossen** ✓. `@kindle/catalog` listet alle 5 KFX-Bücher mit Titel, Fortschritt, Größe, Bundle-Inventar und Cover-URL. DBs werden vor Zugriff nach `os.tmpdir()` kopiert (safe).

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

**Phase 2 — Voucher zuerst** (Nutzerentscheidung):
1. `amzn1.drm-voucher.v1.*.voucher` als Ion-Binary parsen (Header `e0 01 00 ea` = Ion Version Marker) via `ion-js`.
2. Struktur-Dokumentation in `docs/20-keychain-probe.md`: welche Felder existieren, was ist klartextlich, was deutet auf externe Key-Quelle.
3. Erst danach Keychain-Zugriffsversuche: `security`-CLI → Swift-Helper → ggf. LLDB.

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
- **2026-04-17** — Phase 2 gestartet: Keychain-Probe + Voucher-Analyse.
