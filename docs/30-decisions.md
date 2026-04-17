# Architecture Decision Records (ADRs)

Kurze, fortlaufende Notizen zu jeder technischen Weggabelung.

---

## ADR-001 — Extraktionsweg: Reverse-Engineering über Keychain & DRMION

**Datum**: 2026-04-17
**Status**: Akzeptiert

**Kontext**: Die neue Kindle-App auf macOS (Bundle `com.amazon.Lassen`) speichert Bücher lokal, aber DRM-verschlüsselt. Drei Hauptoptionen standen im Raum: (a) UI-Automation + OCR der laufenden App, (b) Cloud-Reader-Scraping mit Vision-LLM, (c) Keychain-Key extrahieren und DRMION-Container selbst entschlüsseln.

**Entscheidung**: Option (c). Ziel: strukturtreue Ausgabe (ePub-taugliches Modell) statt OCR-Fließtext, strikt on-device, keine externen APIs.

**Konsequenzen**:
- Hoher Exploration-Aufwand; es existiert kein öffentlicher Rezeptpfad für Lassen-macOS im April 2026.
- Decision-Gate in Phase 2 (Keychain-Probe): wenn der Schlüssel nicht extrahierbar ist, Pivot auf UI+OCR.
- Phase 1 (Metadaten-Katalog) liefert bereits ohne RE-Erfolg Nutzen → eigenständig wertvoll.

---

## ADR-002 — Stack: NodeJS/TypeScript, Swift nur wo zwingend

**Datum**: 2026-04-17
**Status**: Akzeptiert

**Kontext**: Nutzer favorisiert NodeJS/TypeScript. Einige native macOS-APIs (Keychain mit AccessGroup, evtl. Accessibility) sind aus Node nicht direkt erreichbar.

**Entscheidung**: Monorepo mit pnpm Workspaces. TS-Pakete für Katalog, DRMION, KFX, Exporter. Ein dünner Swift-CLI-Helper in `packages/keychain-probe` für Keychain-Zugriff. Aufruf aus TS per `child_process`.

**Konsequenzen**:
- Minimale Swift-Fläche, maximale TS-Hebelwirkung.
- Keine node-gyp/napi-Drift durch größere native Pakete.
- Wenn UI+OCR-Fallback nötig wird, bekommt der Swift-Helper zusätzliche Sub-Commands (`ax`, `key-event`, `screenshot`, `ocr`).

---

## ADR-003 — KFX-Parser: `ion-js` statt Python/Calibre

**Datum**: 2026-04-17
**Status**: Akzeptiert (vorbehaltlich Phase 4)

**Kontext**: KFX-Container basieren auf Amazon Ion (Binary). Die verbreitete Community-Lösung ist jhowell's KFX-Input-Plugin in Python. Amazon selbst pflegt `ion-js` (MIT/Apache-2.0) als offiziellen JS/TS-Parser.

**Entscheidung**: `ion-js` nativ nutzen, Symbol-Tabellen aus MobileRead-Wiki und KFX-Input-Plugin-Doku ableiten.

**Konsequenzen**:
- Keine Python-Abhängigkeit, keine Calibre-Installation.
- Falls Symbol-IDs unvollständig sind, schrittweise ergänzen; jeder fehlende Symbol-Eintrag bekommt einen ADR-Eintrag.

---

## ADR-004 — ePub-Ausgabe: `epub-gen-memory`

**Datum**: 2026-04-17
**Status**: Akzeptiert (vorbehaltlich Phase 5)

**Kontext**: Optionen: Calibre `ebook-convert` (GPL, schwer, Python/C++), `epub-gen` (alt, npm), `epub-gen-memory` (aktiv, MIT, in-memory).

**Entscheidung**: `epub-gen-memory` als Primär-Output. Zusätzlich eigener Markdown-Emitter ohne Library.

**Konsequenzen**: Kein externer Binary-Zwang, reines TS. Validierung mit `epubcheck` (optional, Java-Tool) als End-zu-End-Test.
