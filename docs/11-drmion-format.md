# Recherchebericht: Kindle-Extraktion aus "Lassen" (Kindle for Mac 2.x, 2025/2026)

## Vorab-Hinweis zur Rechtslage (DE)

Bitte im Hinterkopf behalten: §95a UrhG verbietet in Deutschland die Umgehung "wirksamer technischer Schutzmaßnahmen" auch für Privatkopien nach §53 UrhG. Privater Einzelgebrauch ohne Verbreitung wird i.d.R. nicht verfolgt (allenfalls Ordnungswidrigkeit), gewerbliches oder werkzeugbezogenes Handeln ist nach §108b UrhG jedoch strafbewehrt. Die Eigennutzung ist realistisch tolerierbar, aber juristisch **nicht** explizit "legal" wie im Prompt angenommen — nur niedrig-risikant. Das beeinflusst Toolauswahl (kein Public-Hosting eigener Forks), nicht den technischen Pfad. Der Export der **eigenen Notizen und Highlights** ist dagegen unproblematisch.

---

## Zusammenfassung: Was im April 2026 tatsächlich funktioniert

Die Lage ist 2025 katastrophaler geworden als je zuvor. Amazon hat im Februar 2025 "Download & Transfer via USB" vom Web-Account entfernt, im April 2025 die Server für alte Kindle-for-PC-Versionen (<2.7.1) für neue Bücher abgeschaltet, und im September 2025 mit Kindle-Firmware 5.18.5 eine neue geräteseitige DRM-Schicht ("account secret" in sicherem Speicher) eingeführt, die zuvor arbeitende E-Ink-Geräte als Backup-Pfad eliminiert. Der **neue macOS-Client "Lassen"** (com.amazon.Lassen, vorher com.amazon.Kindle) speichert Bücher als KFX-Container (`.azw8`/`.azw9`/`.azw9.res`/`BookManifest.kfx`) mit neuem DRM-Key-System; die etablierten DeDRM-Plugins können diese Dateien **nicht direkt entschlüsseln**.

Die einzige aktiv weiterentwickelte Community-Linie ist **Satsuoni's DeDRM_tools-Fork** (https://github.com/Satsuoni/DeDRM_tools, letzter Release 10.0.19, April 2026) kombiniert mit **jhowell's KFX Input Plugin** (v2.30.0, April 2026, Mirror: kluyg/calibre-kfx-input). Dieser Pfad adressiert jedoch **Kindle für PC 2.8.0–2.8.3 unter Windows** — nicht die macOS-Lassen-App. Für die Mac-Lassen-App gibt es Stand April 2026 **keinen öffentlichen, funktionierenden DeDRM-Pfad**. `knock` (neverwasmail) ist kein Kindle-Tool (gehört in den Apple-Books-Kosmos und deckt Kindle nicht ab). `kindle_download_helper` (yihong0618) wurde am 18. Juli 2025 archiviert und bedient nur den alten Cloud-Download mit Legacy-DRM.

Das Reverse-Engineering der iOS-App (Anatoly Gerasimov, "Kindle Ebooks") zeigt einen vielversprechenden, aber arbeitsintensiven Angriffsweg: Das Lassen-Binary enthält einen statisch gelinkten nativen Decryptor; per Debugger-Breakpoint auf `BookTextExtractor` lässt sich der entschlüsselte Klartext aus dem Prozess abgreifen. Auf macOS wäre das Äquivalent LLDB + Accessibility-Hooks — nicht trivial, aber prinzipiell machbar, da die Lassen-Bundles die gleiche AppGroup-Identität `group.com.amazon.Lassen` verwenden.

## Für Node/TypeScript-Bibliotheken gilt

Das npm-Ökosystem hat **keine nutzbaren Bibliotheken** für moderne KFX-Entschlüsselung. `node-kindleunpack` (ssnangua) ist ein Wrapper um das alte Python-KindleUnpack und funktioniert nur für Legacy-MOBI/AZW3 ohne DRM. `node-mobi`, `mobi`, `jsebook` sind zwischen 8 und 13 Jahre alt und für AZW-DRM irrelevant. Es gibt keine JS/TS-Ports von DeDRM oder KFX-Input. Alle realistischen Pfade enden bei Python/Calibre-Integration per CLI-Orchestrierung (`child_process.spawn('ebook-convert', ...)` oder `calibre-debug -e …`) — Calibre ist GPL v3, das Plugin-Binding erfolgt per Subprozess.

## Die fünf realistischen Ansätze

### Ansatz 1 — Cloud-Reader-Scraping via Playwright + Vision-Transkription
Projekt: `transitive-bullshit/kindle-ai-export` (MIT, TypeScript, Node 18+). Loggt sich in read.amazon.com ein, scrollt seitenweise, screenshottet per Playwright, transkribiert per GPT-4.1-mini (alternativ Claude/lokales vLLM). Funktioniert stand heute. Pro: Direkt in TS, saubere Architektur, ~30 USD/Roman bei GPT-4.1-mini, ~97 % Textqualität. Contra: Kosten pro Buch, Bilder/Diagramme gehen verloren, Cloud-Reader rendert via WebGL (lokaler Headless-Betrieb klappt, VMs scheitern), potenzielle Rate-Limit-/ToS-Fragen, bei Layoutwechsel auf Amazon-Seite fragil.

### Ansatz 2 — Calibre + Satsuoni-DeDRM + KFX-Input in einer Windows-VM (per CLI orchestriert)
Pfad: Dedizierte Win-VM oder Parallels-Container, darin Kindle for PC 2.8.3 (Auto-Update blockieren), DeDRM 10.0.19 (Satsuoni), KFX Input 2.30, Calibre 7/8. Von macOS/Node per SSH oder geteiltem Ordner ansteuern, `ebook-convert` via CLI. Pro: Aktuell funktionierender Pfad, deterministisches Ergebnis, volle Formattreue (ePub mit Struktur, nicht nur OCR), DRM-Key wird per `kfxkeyextractor` gewonnen. Contra: VM-Overhead, muss das Buch erneut in der VM herunterladen (Lassen-Dateien werden *nicht* verwendet), Amazon kann jederzeit 2.8.4 mit Breakage pushen, Zukunftssicherheit gering, Win-Lizenz nötig.

### Ansatz 3 — UI-Automation der Lassen-Mac-App + Tesseract/Vision-OCR
Kindle-App im Vordergrund, AppleScript/`osascript` oder Swift+Accessibility-API dreht Seiten weiter (Right-Arrow), `screencapture -R` fängt definierten Bereich ab, Tesseract (lokal, kostenlos) oder Vision-LLM transkribiert. Referenz: `transitive-bullshit/kindle-ai-export` als Schablone plus AppleScript-Guides (hansokuwaza.com, yama-mac.com, scombu.com). Pro: Nutzt die bereits lokal entschlüsselten Lassen-Dateien indirekt, keine Netzabhängigkeit, keine Cloud-API-Kosten bei Tesseract, robust gegenüber Amazon-Serveränderungen. Contra: Tesseract auf Kindle-Typografie praktisch 80–95 % (Kapitälchen, Drop-Caps, Ligaturen sind Fehlerquellen); Vision-LLM bringt 97 %+ aber Cloud-Kosten; keine Bilder/Tabellen; Seitenumbrüche müssen heuristisch erkannt werden; App-Fokus-Verlust killt Run.

### Ansatz 4 — Binary-Hooking der Lassen-App (Debugger/Frida)
Wie Anatoly es für iOS demonstriert hat: LLDB- oder Frida-Script auf den Mac-Binary setzen, Breakpoint auf die entschlüsselnde Renderfunktion, Klartext seitenweise aus dem Prozess abgreifen. Pro: Verwendet die Originalentschlüsselung der App, perfekte Treue, funktioniert unabhängig von Amazon-Serverchanges, solange Lassen lokal läuft; höchste theoretische Qualität. Contra: **Sehr** hoher Aufwand (Reverse-Engineering der aktuellen Binary, arm64 + x86_64, Notarization/SIP-Themen, bei jedem App-Update ggf. neue Symbole); rechtlich sensibelster Pfad (klar eine Umgehungsmaßnahme i.S.v. §95a/§108b); vom Prompt-User vermutlich nicht leistbar ohne RE-Erfahrung; kein TS/Node, Frida-Bindings existieren aber (`frida-node`).

### Ansatz 5 — Highlights/Notizen-Export (Notebook-Route)
`read.amazon.com/notebook` listet pro Buch alle eigenen Highlights & Notizen im DOM; Tools wie Clippings.io, Readwise/Bookcision, Glasp scrapen genau das. Pro: Keine DRM-Umgehung (eigene Inhalte), trivial per Puppeteer/Playwright in TS, stabil, kostenlos. Contra: Nur Auszüge, kein Vollbuchtext — erfüllt Ziel "Buch nach Markdown/ePub" **nicht**. Nur als Ergänzung sinnvoll.

## Priorisierungs-Empfehlung

1. **Ansatz 1 (Cloud-Reader + Playwright + Vision-LLM)** als Hauptweg — einzige Lösung, die heute in Node/TS ohne VM funktioniert, kalkulierbare Kosten, gute Qualität, aktive Community.
2. **Ansatz 5 (Notizen-Export)** sofort als "Low-Hanging Fruit" danebenstellen — ist in wenigen Tagen gebaut und hat absehbar juristisch keine Reibung.
3. **Ansatz 3 (UI+OCR der Lassen-App)** als Offline-Fallback, wenn Cloud-Reader-Route durch Amazon zugedreht wird (passiert erfahrungsgemäß alle 6–12 Monate). Tesseract für Privatmenge, Vision-LLM bei Qualitätsbedarf.
4. **Ansatz 2 (Calibre+Satsuoni in VM)** parken als "wenn Vollstrukturtreue kritisch wird" — Win-VM aufsetzen lohnt nur bei großen Beständen.
5. **Ansatz 4 (Binary-Hook)** nur verfolgen, wenn Interesse und Ressourcen für RE vorhanden; sonst rote Linie.

Architektonisch für die TS-Lösung: saubere Adapter-Schicht (`BookSource` Interface: `fetchBook(asin): Promise<RawPages>`), Implementierungen (a) `CloudReaderSource` (Playwright), (b) `LassenAppOCRSource` (osascript + screencapture + OCR), (c) `NotebookSource` (Highlights). Post-Processing-Pipeline (Vision/OCR-Transkription, Dedup von Headern/Footern, Kapitel-Detection, Markdown-Emit, optional ePub via `epub-gen` oder `calibre ebook-convert`). So bleibt der Kern austauschbar, wenn 2026/2027 wieder ein Weg stirbt oder ein neuer aufgeht.

---

# Rohnotizen & Quellen

## Projekte (kompakt)

| Projekt | URL | Letzte Aktivität | Lassen-kompatibel | Lizenz | Stack | Integration in TS |
|---|---|---|---|---|---|---|
| Satsuoni/DeDRM_tools | github.com/Satsuoni/DeDRM_tools | April 2026 (v10.0.19) | nein (Windows/K4PC 2.8.x) | GPL-3 | Python/Calibre | CLI-Wrap in VM |
| noDRM/DeDRM_tools | github.com/noDRM/DeDRM_tools | ~Aug 2024 (v10.0.9 RC1 10.1.0) | nein | GPL-3 | Python/Calibre | CLI-Wrap |
| apprenticeharper/DeDRM_tools | github.com/apprenticeharper/DeDRM_tools | archiviert, vgl. noDRM | nein | GPL-3 | Python/Calibre | – |
| kluyg/calibre-kfx-input (jhowell) | github.com/kluyg/calibre-kfx-input | April 2026 (v2.30.0) | teilweise (braucht DRM-free KFX-ZIP) | kein OSI (closed, Redistribution) | Python | CLI-Wrap |
| transitive-bullshit/kindle-ai-export | github.com/transitive-bullshit/kindle-ai-export | aktiv 2025 | via Cloud Reader (nicht Lassen direkt) | MIT | TS+Playwright+OpenAI | direkt nutzbar |
| uelel/kindle-pdf-scraper | github.com/uelel/kindle-pdf-scraper | 02/2021, ~stale | via Cloud Reader | MIT | JS+Puppeteer+Python | teils direkt |
| abeoma/kindle-cloud-reader-scraping | github.com/abeoma/kindle-cloud-reader-scraping | älter | via Cloud Reader | ? | JS | direkt |
| yihong0618/Kindle_download_helper | github.com/yihong0618/Kindle_download_helper | 18.07.2025 archiviert | nein (alter Cloud-Endpoint) | GPL-3 | Python | CLI (aber tot) |
| hadynz/puppeteer-goodreads | github.com/hadynz/puppeteer-goodreads | älter | Highlights-Scraping | ? | TS+Puppeteer | direkt |
| Clippings.io / Readwise / Bookcision | readwise.io/bookcision usw. | 2025+ aktiv | Notizen-Export | proprietär | Extension | nur als Service |
| ssnangua/node-kindleunpack | github.com/ssnangua/node-kindleunpack | älter | nein (nur unverschlüsselt) | MIT | Node-Wrapper | direkt, aber nutzlos für DRM |
| knock (neverwasmail) | github.com/neverwasmail/knock | Apple Books, nicht Kindle | irrelevant | – | – | – |
| Epubor Ultimate / BookFab | kommerziell | 2025 aktiv | unklar (nur bestimmte Cutoffs) | proprietär, 30–60 €/Jahr | GUI | CLI-Automatisierung schwierig |

## Zentrale Referenz-Links

- https://blog.the-ebook-reader.com/2025/02/12/download-transfer-for-kindle-ebooks-going-away-on-february-26/
- https://blog.the-ebook-reader.com/2025/09/23/new-drm-added-to-kindles-with-5-18-5-update-breaking-drm-removal/
- https://blog.the-ebook-reader.com/2025/10/17/list-of-kindles-that-support-drm-removal-for-kindle-ebooks/
- https://blog.the-ebook-reader.com/2025/03/11/3-ways-to-download-and-transfer-kindle-ebooks-yeah-its-still-possible/
- https://www.mobileread.com/forums/showthread.php?t=351285 (Amazon and DRM changes – Sammel-Thread)
- https://www.mobileread.com/forums/showthread.php?t=291290 (KFX Input Plugin – jhowell)
- https://www.mobileread.com/forums/showthread.php?t=356810 (azw9.res – negative Bestätigung)
- https://github.com/apprenticeharper/DeDRM_tools/discussions/2395 (2025 – DeDRM nicht mehr funktional)
- https://github.com/apprenticeharper/DeDRM_tools/discussions/2160 (Kindle for Mac 1.39 DRM)
- https://github.com/Satsuoni/DeDRM_tools/discussions/25 (K4PC 2.8 Tool)
- https://github.com/Satsuoni/DeDRM_tools/releases
- https://github.com/kluyg/calibre-kfx-input
- https://github.com/transitive-bullshit/kindle-ai-export
- https://github.com/uelel/kindle-pdf-scraper
- https://github.com/yihong0618/Kindle_download_helper
- https://anatoly.works/stories/kindleEbooks.html (iOS-RE mit Lassen AppGroup)
- https://textmuncher.com/blog/kindle-drm-removal-2026
- https://textmuncher.com/blog/copy-text-kindle-cloud-reader
- https://wiki.mobileread.com/wiki/KFX
- https://www.androidpolice.com/amazon-closing-kindle-loophole-remove-drm/
- https://www.ereadersforum.com/threads/list-of-kindle-models-that-still-support-drm-removal-october-2025-update.9555/
- https://consumerrights.wiki/w/Amazon_Kindle_removes_download_feature_of_purchased_books
- https://privatkopie.net/drm-kopierschutz/ (DE-Rechtslage)
- https://dejure.org/gesetze/UrhG/53.html

## Technische Detail-Fundstücke

- **Lassen-AppGroup-ID**: `group.com.amazon.Lassen`, geteilter Keychain-Eintrag gleichen Namens (bestätigt via Anatoly / iOS-RE, gleiche Identität auf macOS).
- **Dateilayout neuer Kindle-Container**: Hauptcontainer `.azw8`, Ressourcen `.azw9`/`.azw9.res`, Metadaten `.azw9.md`, Manifest `BookManifest.kfx`, DRM-Voucher mit Header `\xe0\x01\x00\xea`, encrypted payload beginnt mit `\xeaDRMION\xee`.
- **KFX-Container**: Amazon-Ion-Binärformat, ZIP-Varianten (KFX-ZIP) tragen manchmal `.kfx-zip`. Entschlüsselungspfad läuft über Voucher → PID-basierte Key-Ableitung.
- **Kindle-for-PC-Versionen, die heute noch crackbar sind**: 1.17–1.24 (Alt-DRM) und 2.8.0–2.8.3 mit Satsuoni-Extraktor. Version 2.4.0 funktioniert nur für Bücher vor ~23. April 2025.
- **Tesseract auf Kindle-Typografie**: realistisch 80–95 %, mit Preprocessing (Schwellwert, Deskew, DPI-Upscaling) +~20 % erreichbar; TextMuncher behauptet 97 % bei GPT-4-basiertem OCR; Drop-Caps und Ligaturen bleiben Problem.
- **Send-to-Kindle / Whispersync-Endpoints**: nicht als Extraktions-Ersatz nutzbar (Whispersync liefert Positionen/Highlights, nicht Textblöcke; Send-to-Kindle ist Einbahnstraße in die Lassen-Storage).
