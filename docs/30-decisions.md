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

## ADR-005 — Content-Key per LLDB-Memory-Dump + Known-Plaintext-Brute-Force

**Datum**: 2026-04-17
**Status**: Akzeptiert (Funktioniert für OWW verifiziert)

**Kontext**: Der Voucher referenziert `ACCOUNT_SECRET` + `CLIENT_ID` als Keychain-AppGroup-Items. Eine ad-hoc signierte Swift-CLI mit passenden Entitlements wurde von `securityd` silent abgewiesen. Lassen nutzt CryptoKit statt CommonCrypto, daher schlug ein `CCCryptorCreate`-Hook fehl.

**Entscheidung**: Pragmatische Alternative via In-Process-Memory-Scan: LLDB attach → writable Regionen < 4 MiB dumpen (235 MiB) → Offline-Brute-Force über jedes 8-Byte-aligned 16-Byte-Window als AES-128-Key. Validierung: 5 unabhängige (Ciphertext, IV)-Paare aus derselben .azw8-Datei, alle müssen mit demselben Key PKCS7-valid padden. False-Positive-Rate: (1/256)^5 ≈ 10^-12.

**Konsequenzen**:
- Extraktion pro Buch: Nutzer öffnet das Buch in Lassen, wir dumpen und brute-forcen. ~100 Sekunden pro Buch auf Apple Silicon (235 MiB / stride=8 / 5 Chunks × AES-128-CBC).
- **Keine** Keychain-Manipulation zur Laufzeit. Nach einmaliger Extraktion speichern wir `uuid → key-bytes` in lokalem Config-File; die Produktionslösung ist damit keychain-los.
- Ein einziger Key hängt pro Buch. ACCOUNT_SECRET und CLIENT_ID müssen wir **nicht** herausfinden.
- Wenn Amazon in einer zukünftigen Lassen-Version keine Content-Keys mehr plaintext in App-Memory hält, wird dieser Ansatz brechen — dann müssen wir auf echtes Hook-RE (CryptoKit / corecrypto) ausweichen.

**Erkennungen für die Dateistruktur**:
- `.azw8` = 8 Byte DRMION-Magic + Ion-Stream mit Metadaten-Struct + (Ciphertext, IV)-Chunks + Signatur
- Chunk-Cipher: AES-128-CBC-PKCS5Padding
- Chunk-Kompression: LZMA "alone" (Props byte 0x5D, 4 MiB Dict, 8-Byte Uncompressed-Length-Feld, Pre-Sub-Chunk-Größe 10240 Bytes)
- Pro .azw8 sind ~1–3 Gruppen, jede mit eigener Metadaten-Kopie (gleich über Gruppen)

---

## ADR-007 — Projekt-Ende in diesem Strang: Lassen-Local-RE braucht SIP-off, OCR-Alternativen sind der aussichtsreichere Praxis-Pfad

**Datum**: 2026-04-17
**Status**: Akzeptiert. Dieser Strang ist abgeschlossen; OCR-basierte Alternativen sind für die Produktions-UX die realistischere Route.

**Kontext**: Ziel war, selbst gekaufte Kindle-Bücher lokal aus der macOS-Lassen-App in Markdown/ePub zu extrahieren, **ohne** SIP zu deaktivieren. Nach Phase 2c hatten wir einen funktionierenden Memory-Brute-Force-Enrollment-Workflow, der aber `task_for_pid` auf Lassen braucht.

**Empirische Landkarte der SIP=on-Wege** (alle am 2026-04-17 auf macOS 26.3.1 Apple Silicon mit geöffnetem Kindle getestet; Commits `1d85702`, `fe0cf70`, `8e439f2`):

| Angriffsfläche | Ergebnis |
|---|---|
| Apple `debugserver` + TCC "Developer Tools" | Kernel-level reject (`KERN_FAILURE` in 1 ms, kein tccd-Log) |
| Ad-hoc signiertes Binary mit public `cs.debugger`-Entitlement | Kernel-level reject (AMFI stripped restricted Entitlement) |
| Ad-hoc `cs.debugger` + `get-task-allow`-Entitlement | Kernel-level reject |
| `fs_usage`-Trace auf Lassens Lese-/Schreibzugriffe | Keine Plaintext-Key-Material-Writes auf Platte. Alle crypto-sensiblen Daten nur im Data-Protection-Keychain |
| User-Keychain-Export | Nur `mobilePandaAccountManager:com.amazon.Lassen` = DSN (Device-ID). ACCOUNT_SECRET und per-Book-Keys sind in der Data-Protection-Keychain unter `agrp = J7P34ALZ5R.com.amazon.Lassen`, SEP-gesichert, offline nicht entschlüsselbar |
| Documents-Folder der Container-App | Enthält nur leere Stub-Plists (`assets.plist`, `downloads.plist`, `voucher-modules.plist`, `syncFileMetadata.plist` — je 42 B). fs_usage-Pfade wie `voucher-modules.plist/book.kcr` waren failed syscalls (ENOTDIR), kein Fund |
| Binary-Modifikation / Re-Signing | Bricht Amazon-Team-ID-Bindung in Keychain-AppGroup-ACL → verlorener Keychain-Zugriff → App kann sich nicht mehr authentifizieren |

**Noch nicht empirisch abgeschlossen**: HTTPS-MITM mit mitmproxy + system-trusted CA (Smoketest-Doku in `packages/keychain-probe/scripts/recon/mitm-smoketest.md`). Erwartung: Amazon pinnt Certs auf DRM-Endpunkten. Würde nach aktuellem Kenntnisstand wahrscheinlich fehlschlagen und bringt auch im Erfolgsfall nur ACCOUNT_SECRET, nicht die per-Book-Keys direkt — also einen Schritt näher, nicht die Lösung. Nicht mehr verfolgt.

**Entscheidung**: Projekt in diesem Strang schließen. Die ausgearbeiteten Bausteine bleiben nutzbar (siehe `docs/00-state.md` und `packages/*`):
- Catalog-CLI funktioniert auf jedem macOS ohne Spezialrechte.
- Voucher-Parser + DRMION-Chunks-Reader funktionieren auf jedem macOS.
- Enrollment-Workflow funktioniert einmal-pro-Buch auf SIP=off-macOS.
- DRMION-Format, Ion-Struktur und LZMA-alone-Layout sind dokumentiert (`docs/10-filesystem.md`, `docs/20-keychain-probe.md`).

**Alternative Extraktions-Wege, die ohne SIP-off funktionieren und aussichtsreicher sind**:

1. **Kindle Cloud Reader (`read.amazon.com`) + Headless Browser** — Puppeteer/Playwright, DOM-Scraping des gerenderten Buch-Contents. Nicht OCR, echter Text. Strukturtreu (HTML → Markdown). Referenz: [`transitive-bullshit/kindle-ai-export`](https://github.com/transitive-bullshit/kindle-ai-export) (MIT, TS).

2. **UI-Automation der Lassen-App + Apple Vision OCR** — AppleScript/Accessibility-API + `screencapture` + Vision-Framework. On-device, keine Cloud-Kosten. Funktioniert auf SIP=on, braucht TCC-Permissions für Accessibility + Screen Recording. Details in `docs/12-ui-ocr-fallback.md`.

3. **Jailbroken iOS-Device + Frida auf Kindle iOS-App** — gleicher Codestamm wie Lassen-Catalyst, aber auf iOS kommt man per Jailbreak an Memory. Keine Mac-SIP-Änderung nötig, braucht aber separates Device.

Für einen Produktionsweg, der auf stock-macOS ohne Sonderrechte funktioniert und strukturtreue Ausgabe liefert, ist **Option 1 (Cloud Reader DOM Scraping)** die realistischste. Technisch ist es gegenüber OCR-Varianten präziser (kein Vision-Pass nötig), der Code ist TS-nativ, das Referenz-Projekt aktiv.

**Konsequenzen**:
- Runtime-Packages (Phase 3–5) **nicht mehr gebaut** in diesem Strang, weil sie ohne einen skalierbaren Enrollment-Weg nur einen bereits-enrolled-OWW-Sonderfall absichern würden — zu wenig Nutzen.
- Repo bleibt als Forschungsartefakt stehen, mit voll funktionsfähigem Catalog + dokumentiertem DRMION-Format für zukünftige Arbeiten.

---

## ADR-006 — Enrollment-Architektur (einmalig) + Runtime (keychain-los)

**Datum**: 2026-04-17
**Status**: Akzeptiert. **Sowohl TCC-Developer-Tools- als auch Dev-ID-/cs.debugger-Hypothese sind empirisch widerlegt** (macOS 26.3.1 Apple Silicon, Tests am 2026-04-17). Enrollment benötigt **SIP-off**.

**Kontext**: Erkundung der macOS-Keychain hat bestätigt, dass auf einem locked-down System (SIP an, AMFI an, keine Sonder-Entitlements) die Lassen-AppGroup-Keychain-Einträge nicht lesbar sind. SEP-Binding + Team-ID-Check in `securityd` sind Apples Design, keine umgehbare Fehlkonfiguration. Ein wirklich generisches "läuft auf jedem Mac"-Key-Extract ist daher ausgeschlossen.

**Entscheidung**: Architektur in zwei Stufen:
1. **Enrollment-Modus** (`kindle-enroll enroll <ASIN>`): benötigt **SIP deaktiviert** (csrutil disable) während der Extraktion. Kann für mehrere Bücher am Stück in einer SIP-off-Session erledigt werden. Danach kann SIP wieder aktiviert werden.
2. **Runtime-Modus**: liest nur `~/.config/kindle-extractor/keys.json` + `.azw8`-Dateien. Kein LLDB, kein Keychain-Zugriff. Läuft auf jedem macOS ohne Sonderrechte — SIP an oder aus.

**Empirische Befunde zu allen SIP=on-Wegen (2026-04-17, macOS 26.3.1 Apple Silicon)**:

| Variante | Entitlement-Quelle | Ergebnis |
|---|---|---|
| Apple `debugserver` + TCC "Developer Tools" | Apple-signed, `com.apple.private.cs.debugger` | **KERN_FAILURE 0x5** nach ~1 ms, keine tccd-Entries |
| ad-hoc binary, kein Entitlement | — | KERN_FAILURE 0x5 (Referenz-Fail) |
| ad-hoc binary, `com.apple.security.cs.debugger` | ad-hoc sig | **KERN_FAILURE 0x5** — AMFI entfernt restricted Entitlement bei ad-hoc Signatur |
| ad-hoc binary, `cs.debugger` + `get-task-allow` | ad-hoc sig | KERN_FAILURE 0x5 |

**Deutung**: Auf macOS 26 Apple Silicon wird für Production-Apps mit `get-task-allow=false` + Hardened Runtime der `task_for_pid`-Call auf Kernel-Ebene sofort blockiert. Weder TCC noch Entitlements können das umgehen, solange die Caller-Signatur nicht durch ein Apple-genehmigtes Provisioning-Profil legitimiert ist.

**Noch theoretisch verbliebene Variante**: Apple Developer Program ($99/Jahr) + explizit per Apple-Approval legitimiertes `cs.debugger`-Entitlement. Apple reviewt restricted Entitlements manuell; für ein "Kindle decrypt tool" ist eine Ablehnung nahezu sicher. **Out of scope**.

**Verworfene Varianten**:
- `csrutil enable --without debug`: auf Apple Silicon nicht verfügbar.
- `amfi_get_out_of_my_way=0x1` boot-arg: benötigt SIP-off zum Setzen.

**Konsequenzen**:
- Enrollment-Workflow dokumentiert in `docs/21-enrollment.md` und `docs/ONBOARDING.md` wird auf **"SIP vorübergehend deaktivieren"** umgestellt.
- Neuer Kauf / neues Buch → einmaliges Enrollment mit SIP-off-Reboot nötig. Batch-Enrollment (alle Bücher in einer Session) dämpft den Aufwand.
- Runtime-Modus bleibt unverändert locked-down-fähig.

---

## ADR-004 — ePub-Ausgabe: `epub-gen-memory`

**Datum**: 2026-04-17
**Status**: Akzeptiert (vorbehaltlich Phase 5)

**Kontext**: Optionen: Calibre `ebook-convert` (GPL, schwer, Python/C++), `epub-gen` (alt, npm), `epub-gen-memory` (aktiv, MIT, in-memory).

**Entscheidung**: `epub-gen-memory` als Primär-Output. Zusätzlich eigener Markdown-Emitter ohne Library.

**Konsequenzen**: Kein externer Binary-Zwang, reines TS. Validierung mit `epubcheck` (optional, Java-Tool) als End-zu-End-Test.
