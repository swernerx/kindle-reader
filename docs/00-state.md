# Live Status

> Diese Datei wurde während der aktiven Entwicklung **nach jedem substanziellen Arbeitsblock** aktualisiert. Sie hält den Endstand fest.

## Aktueller Stand

**Phase**: Forschungs-Strang abgeschlossen.
**Ampel**: 🟡 Teil-Erfolg. Lokale Lassen-RE funktioniert mit SIP=off (Enrollment-Modus). SIP-frei nicht erreichbar. Pragmatischere Route ist Cloud Reader DOM Scraping — außerhalb dieses Repos.
**Lassen-Version (referenziert)**: 7.56, Build 1.430240.10
**macOS-Versionen getestet**: Darwin 25.3.0 (SIP=off, Primär-Mac) und macOS 26.3.1 Build 25D2128 Apple Silicon (SIP=on, Test-Mac)
**SIP-Anforderung für das was wir gebaut haben**: für Enrollment **zwingend aus**, für Runtime der Teil-Pakete nicht nötig.

## Was funktioniert

- **`@kindle/catalog`** — listet lokal heruntergeladene KFX-Bücher mit Titel, Fortschritt, Größe, Bundle-Inventar und Cover-URL. Keine Sonderrechte. ✓
- **`@kindle/drmion` (Voucher + DRMION-Parser)** — parst on-disk `.voucher`- und `.azw8`-Dateien zu strukturierten Typen. Keine Sonderrechte. ✓
- **`@kindle/keychain-probe` (Enrollment)** — `kindle-enroll enroll <ASIN>`: zieht per lldb den per-book AES-Key aus Lassens Arbeitsspeicher und persistiert ihn in `~/.config/kindle-extractor/keys.json`. **Funktioniert nur auf SIP=off.** Verifiziert für B0090RVGW0 (On Writing Well) — 33 Sekunden End-to-End, recovery AES-128-Key `a931438314febc3641495ec212eae24d`.

## Was nicht gebaut wurde

- **`@kindle/drmion.decryptBook`** — Runtime-Entschlüsselung. Haben wir bewusst nicht mehr gebaut, weil die Enrollment-Beschränkung (SIP=off) den Nutzen begrenzt.
- **`@kindle/kfx-parser`** — KFX/Ion-Parser für strukturierten Buch-Content.
- **`@kindle/exporter`** — Markdown + ePub Emitter.

Diese Pakete existieren als leere Stubs im Repo. Wer den Strang fortsetzen will: das DRMION-Format ist in `docs/20-keychain-probe.md` vollständig dokumentiert.

## Was wir empirisch gelernt haben

- Lassen ist eine **Mac Catalyst**-App (`arm64-apple-ios-macabi`), Team-ID `94KV3E626L`, Keychain-AppGroup `J7P34ALZ5R.com.amazon.Lassen`.
- Voucher-Format (1166 B on-disk): Ion Binary 1.0 mit AES/CBC/PKCS5Padding + HmacSHA256, referenziert `ACCOUNT_SECRET` und `CLIENT_ID` als Named-Key-Derivation-Inputs (Werte im Data-Protection-Keychain).
- DRMION-Dateien (`.azw8`/`.azw9.res`/`.azw9.md`): 8-Byte-Magic + Ion-Stream mit Klartext-Metadaten (Content-Key-UUID, Cipher-Spec, Voucher-ID, Compression) + (Ciphertext+IV)-Chunks + RSA-Signatur.
- Pro Chunk: AES-128-CBC-PKCS5 + LZMA-alone (Props 0x5D, Dict 4 MiB, 10240-B Sub-Chunks).
- Der per-Book AES-Key liegt **plaintext in Lassens Heap** solange das Buch im Reader geöffnet ist. Knock-out-Kriterium für Enrollment ohne laufende App.

## Was empirisch nicht ging (macOS 26.3.1 Apple Silicon SIP=on)

- Apple `debugserver` + TCC "Developer Tools" → `task_for_pid` Kernel-early-reject
- ad-hoc signiertes Binary mit `com.apple.security.cs.debugger` → AMFI stripped die restricted Entitlement
- Lokaler Keychain-Zugriff ohne Amazon-Team-ID → `errSecMissingEntitlement`
- fs_usage + Documents-Folder → keine Plaintext-Key-Writes auf Platte
- Binary-Modifikation / Re-Signing → würde Keychain-AppGroup-ACL brechen

Details in `docs/30-decisions.md` ADR-007.

## Empfehlung für wer weitermachen will

Die klassische DRM-Umgehungs-Route ist auf modernem macOS Apple Silicon für Produktions-Apps wie Lassen im Wesentlichen geschlossen. Realistische Alternativen, die SIP-frei laufen und Volltext+Struktur liefern:

1. **Kindle Cloud Reader DOM Scraping** (nicht OCR, echter Text aus dem Browser-DOM). Referenz: `transitive-bullshit/kindle-ai-export` (MIT, TS).
2. **UI-Automation + Apple Vision OCR** (on-device, strukturtreu für Fließtext, schwach bei Tabellen/Formeln).

Beide erfordern Amazon-Login-Zugriff für das jeweilige Buch, aber keine SIP-/AMFI-Änderung.

## Verlauf (vollständig)

- **2026-04-17** — Explore-Phase abgeschlossen (drei parallele Research-Agenten: Dateisystem-Erkundung, Extraktions-Tool-Landschaft, UI-OCR-Fallback).
- **2026-04-17** — RE-Pfad gewählt (Keychain → DRMION → KFX → Markdown/ePub). On-device-Constraint.
- **2026-04-17** — Phase 0 abgeschlossen: pnpm-Monorepo, Doku-Skelett.
- **2026-04-17** — Phase 1 abgeschlossen: `@kindle/catalog` listet alle 5 KFX-Bücher.
- **2026-04-17** — Phase 2a abgeschlossen: Voucher-Parser für `amzn1.drm-voucher.v1.*.voucher`.
- **2026-04-17** — Phase 2b abgeschlossen: Memory-Brute-Force-Extraktion des AES-Content-Keys aus Lassens Heap.
- **2026-04-17** — Phase 2c abgeschlossen: `kindle-enroll enroll <ASIN>` als CLI, 33 s End-to-End.
- **2026-04-17** — Zweit-Mac mit SIP=on getestet. TCC-Developer-Tools-Hypothese empirisch widerlegt (Kernel-early-reject ohne TCC-Konsultation).
- **2026-04-17** — `tfp-probe`-Minimal-Binary getestet: ad-hoc `cs.debugger` auch SIP=on gescheitert (AMFI stripped Entitlement).
- **2026-04-17** — Passive Recon: `fs_usage` + User-Keychain-Dump + Documents-Folder-Analyse. **Null verwertbares SIP-freies Material gefunden.** Lassen ist Security-technisch sauber gebaut.
- **2026-04-17** — Projekt in diesem Strang formell geschlossen (ADR-007). Repo bleibt als Forschungsartefakt + Doku-Referenz, Produktions-UX soll via Cloud Reader / UI-OCR (außerhalb dieses Repos) realisiert werden.
