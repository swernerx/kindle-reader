# kindle-reader

> **Status: Forschungs-Strang abgeschlossen.** Lokales DRM-Reverse-Engineering der macOS-Lassen-App (`com.amazon.Lassen`) funktioniert nur mit deaktiviertem SIP. Für den Produktions-Einsatz wäre ein OCR-basierter Weg (Cloud Reader DOM Scraping oder UI-Automation + Apple Vision) die realistischere Route — außerhalb dieses Repos.

Dieses Repository dokumentiert ein ernsthaftes Forschungs-Experiment zur **lokalen Extraktion eigener, gekaufter Kindle-Bücher** aus der neuen macOS-Kindle-App (Mac Catalyst, `arm64-apple-ios-macabi`) in strukturtreue Markdown/ePub-Ausgaben.

Der Strang wurde formell beendet, nachdem empirisch feststand, dass auf macOS 26 Apple Silicon mit aktiviertem SIP **kein** Weg existiert, an Lassens per-Book-Keys zu kommen. Alle untersuchten Pfade sind in `docs/30-decisions.md` ADR-007 aufgelistet.

## Was hier funktioniert

- **`@kindle/catalog`** ([packages/catalog](packages/catalog/)) — listet die lokal heruntergeladenen KFX-Bücher aus `BookData.sqlite` mit Titel, Fortschritt, Größe, Bundle-Inventar, Cover-URL. Funktioniert auf jedem macOS ohne Sonderrechte.

  ```bash
  pnpm --filter @kindle/catalog start -- --verbose
  ```

- **`@kindle/drmion`** ([packages/drmion](packages/drmion/)) — Voucher-Parser (`amzn1.drm-voucher.v1.*.voucher`) und DRMION-Chunks-Reader (`.azw8`/`.azw9.res`/`.azw9.md`) als wiederverwendbare TS-Module. Keine Sonderrechte.

- **`@kindle/keychain-probe`** ([packages/keychain-probe](packages/keychain-probe/)) — Enrollment-CLI `kindle-enroll enroll <ASIN>`, das per lldb den per-Book AES-Key aus Lassens Arbeitsspeicher zieht und in `~/.config/kindle-extractor/keys.json` persistiert. **Braucht SIP=off** (verifiziert: macOS-TCC "Developer Tools" und Dev-ID-Entitlements reichen nicht, [ADR-006](docs/30-decisions.md)).

## Was hier NICHT gebaut wurde

- `@kindle/drmion.decryptBook` — Runtime-Entschlüsselung eines enrolled Buchs
- `@kindle/kfx-parser` — KFX/Ion-Parser für strukturierten Buch-Content
- `@kindle/exporter` — Markdown + ePub Emitter

Begründung: Der vorgelagerte Enrollment-Schritt braucht SIP=off. Die Produktions-Alternative (Cloud Reader DOM Scraping) wäre eine komplett andere Adapter-Implementierung und lebt besser in einem eigenen Projekt.

## Architektur der lokalen RE-Route (dokumentiert, wie es gedacht war)

```
┌──────────────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│  Enrollment (SIP=off)│     │  Runtime (jedes macOS)  │     │     Output       │
│                      │     │                         │     │                  │
│  kindle-enroll       │     │  @kindle/drmion         │     │  .md + .epub     │
│    → lldb attach     │     │  decryptBook(path,      │────▶│  strukturtreu    │
│    → memory dump     │     │               keys.json)│     │                  │
│    → brute-force     │     │                         │     │                  │
│    → keys.json       │─────▶│  @kindle/kfx-parser     │     │                  │
│                      │     │  parseChunks(ionStream) │     │                  │
│                      │     │                         │     │                  │
│                      │     │  @kindle/exporter       │     │                  │
└──────────────────────┘     └─────────────────────────┘     └──────────────────┘
         ↑                              ↑
    SIP=off pflicht                SIP=on/off egal
```

Stufen 1 (Enrollment) und Stufen 2+ (Runtime) sind bewusst getrennt. Einmal enrollte Keys sind stabil gegenüber Neustart, Account-State etc., solange Amazon-Account und Device-Pairing unverändert bleiben.

## Was wir empirisch gelernt haben

- Voucher-Format (on-disk): Ion Binary 1.0, AES/CBC/PKCS5Padding + HmacSHA256, referenziert `ACCOUNT_SECRET` + `CLIENT_ID`.
- DRMION-Dateien: 8-Byte-Magic + Ion-Stream mit Klartext-Metadaten + (Ciphertext+IV)-Chunks + RSA-Signatur.
- Chunks: AES-128-CBC-PKCS5 + LZMA-alone (Props 0x5D, Dict 4 MiB, 10240-B Sub-Chunks).
- Der per-Book AES-Key liegt **plaintext in Lassens Heap**, solange das Buch im Reader geöffnet ist. Im `dump_small`-Brute-Force finden wir ihn in ~30 s.
- Alle sensiblen Daten (ACCOUNT_SECRET, per-Book-Keys) liegen sonst nur im Data-Protection-Keychain, SEP-gesichert, offline nicht entschlüsselbar.

Details: [`docs/10-filesystem.md`](docs/10-filesystem.md), [`docs/20-keychain-probe.md`](docs/20-keychain-probe.md), [`docs/21-enrollment.md`](docs/21-enrollment.md).

## Was NICHT funktioniert auf SIP=on macOS 26 Apple Silicon

Mit detaillierten Logs und Minimal-Test-Programmen empirisch verifiziert:

| Ansatz | Ergebnis |
|---|---|
| Apple `debugserver` + TCC Developer Tools | Kernel-early-reject in 1 ms |
| Ad-hoc `com.apple.security.cs.debugger` Entitlement | AMFI stripped Entitlement |
| User-Keychain-Query auf Lassen-Items | `errSecMissingEntitlement` |
| fs_usage-Trace auf Lassen-Datei-I/O | keine Plaintext-Key-Writes |
| Binary-Modifikation / Re-Signing | bricht Keychain-AppGroup-ACL |

**Noch offen (nicht getestet)**: HTTPS-MITM mit mitmproxy. Erwartung: DRM-Endpunkte haben Cert-Pinning, Metadaten-APIs nicht. Würde im Erfolgsfall auch nur ACCOUNT_SECRET liefern, nicht die per-Book-Keys direkt. Smoketest-Anleitung in [`packages/keychain-probe/scripts/recon/mitm-smoketest.md`](packages/keychain-probe/scripts/recon/mitm-smoketest.md) liegt bereit, falls jemand den Strang aufnehmen will.

## Die aussichtsreichere Produktions-Route: **Cloud Reader DOM Scraping**

Nicht Teil dieses Repos, aber für alle, die zu einem praktisch einsetzbaren Tool kommen wollen:

**Kindle Cloud Reader** ([read.amazon.com](https://read.amazon.com)) rendert Bücher als **HTML/CSS im Browser-DOM**, nicht als Pixel. Ein Headless Browser (Puppeteer/Playwright) kann die Inhalte **als echten Text** auslesen — inklusive Absätze, Überschriften, `<em>`/`<strong>`-Auszeichnung, Bildreferenzen. Das ist **nicht OCR**, sondern Strukturtreue-First.

Referenz: [`transitive-bullshit/kindle-ai-export`](https://github.com/transitive-bullshit/kindle-ai-export) (MIT, TS) — nutzt zusätzlich Vision-LLM für optional-Nachbesserung, kann aber ohne laufen.

Vorteile gegenüber dem lokalen RE-Weg:
- Keine SIP-/AMFI-Änderung nötig
- Läuft auf jedem Mac, jedem Betriebssystem
- Zukunfts-sicher gegen Updates der Lassen-App (Amazon ändert Cloud Reader auch, aber anders)
- Amazon-Login statt File-System-Access

Nachteile:
- Amazon kann Cloud Reader jederzeit abstellen oder UI ändern → Adapter-Pflege nötig
- Cookies/Session müssen erstmalig etabliert werden

**Rein TCC-basierter UI-OCR-Weg** (Lassen-App + Apple Vision): siehe [`docs/12-ui-ocr-fallback.md`](docs/12-ui-ocr-fallback.md). Funktioniert on-device, strukturtreu für Fließtext, schwach bei Tabellen/Formeln.

## Doku-Übersicht

- [`docs/00-state.md`](docs/00-state.md) — Endstand + Verlauf
- [`docs/10-filesystem.md`](docs/10-filesystem.md) — Lassen-Container-Layout
- [`docs/11-drmion-format.md`](docs/11-drmion-format.md) — Research-Agent-Report zur Landschaft (2026-04)
- [`docs/12-ui-ocr-fallback.md`](docs/12-ui-ocr-fallback.md) — UI-OCR-Referenz
- [`docs/20-keychain-probe.md`](docs/20-keychain-probe.md) — Voucher- und DRMION-Format, Phase-2-Notizen
- [`docs/21-enrollment.md`](docs/21-enrollment.md) — Enrollment-Pipeline und Datei-Formate
- [`docs/30-decisions.md`](docs/30-decisions.md) — ADRs inkl. ADR-007 Abschluss-Entscheidung
- [`docs/99-legal.md`](docs/99-legal.md) — §95a / §53 UrhG Einordnung, Eigennutzungs-Scope
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — Setup für eine neue Entwicklungs-Session

## Rechtliches

Dieses Repo dokumentiert ausschließlich eine Forschungs-Untersuchung für den Privatgebrauch durch den Autor mit eigenen, legal bei Amazon gekauften Kindle-Büchern. Siehe [`docs/99-legal.md`](docs/99-legal.md). Keine Schlüssel, entschlüsselten Inhalte oder Lassen-Binaries im Repo.
