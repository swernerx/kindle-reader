# Kindle-Extraktion via UI-Automation + OCR auf macOS — Recherche-Bericht

**Kontext**: NodeJS/TypeScript-Fallback-Pipeline, wenn die DRM-/Dateisystem-Route scheitert. Ziel: saubere Markdown-Ausgabe eigener, legal erworbener Kindle-Bücher (DE).
**Umgebung vor Ort**: macOS 15/26 (Sequoia/Tahoe), `com.amazon.Lassen` Version 7.56, Build 1.430240.10 (installiert unter `/Applications/Amazon Kindle.app`).

---

## 1. App-Steuerung + Fensterfokus

**AppleScript / JXA — praktisch unbrauchbar.** Die Inspektion des Bundles zeigt: Kein `*.sdef` in `Contents/Resources/`, kein `NSAppleScriptEnabled` und kein `OSAScriptingDefinition`-Key in `Info.plist`. Die App ist nicht scriptable. `tell application "Amazon Kindle" to get ...` liefert nur generische Standard-Suite-Befehle (`activate`, `quit`), keinen Buchinhalt, keine Seitennummer, keine Selektion. Realistisch sind nur `System Events`-Keystrokes (über GUI Scripting, also Accessibility-Permission). JXA via `wtfaremyinitials/jxa` bringt keinen Vorteil gegenüber `osascript`.

**Accessibility API (AXUIElement) — eingeschränkt, aber der beste Hebel.** Kindle rendert den Buchtext offenbar überwiegend in einem Custom-View (WebKit/Canvas-artig). Erfahrungen aus vergleichbaren Readern zeigen: Der AX-Baum exponiert meist nur `AXWindow`, Toolbar-Buttons und einen großen `AXGroup`/`AXScrollArea`, aber **keine strukturierten Textknoten** (`AXStaticText`) auf Absatzebene. Für das Orchester-Lesen von Metadaten (Fenstertitel = Buchtitel + ggf. Fortschrittsanzeige) und zum Triggern von Button-Actions ist es trotzdem wertvoll.

Node-Bindings:
- `macos_accessibility_client` (napi-rs, Rust) — **nur Permission-Check** (`applicationIsTrusted`, `applicationIsTrustedWithPrompt`). Kein Baum-Walking.
- `Igalia/acacia` (SWIG, Python+Node) — echter AX-Tree-Inspector, node-gyp-Build nötig.
- Empfehlung: **eigener Swift-CLI-Helper** (ca. 150 Zeilen) via `child_process`. Gibt JSON des AX-Baums + gezielte Actions zurück. Deutlich robuster als bestehende Node-Bindings.

**Keyboard-Events (Umblättern).** Zwei Pfade:
- `CGEventPost(tap, keyDown/keyUp)` mit Keycode `0x7C` (Right Arrow) oder `0x79` (Page Down) — system-weit, benötigt Accessibility-Permission, trifft das **fokussierte** Fenster.
- `AXUIElementPostKeyboardEvent` gezielt auf die Kindle-App — umgeht Fokus-Race, aber wird von Custom-Renderern nicht immer akzeptiert.
- AppleScript-Fallback: `tell application "System Events" to tell process "Kindle" to key code 124`.

Keyboard-Shortcuts für Kindle Mac laut Amazon-Doku: Pfeil-rechts / Leertaste = nächste Seite, Pfeil-links = vorherige Seite, `Cmd+G` = Go To Location.

**Fokus-Robustheit.** Notifications, Spotlight, andere Apps können Fokus stehlen. Mitigation: vor jedem Key-Event `NSRunningApplication(bundleIdentifier: "com.amazon.Lassen").activate(options: .activateIgnoringOtherApps)` aus Swift-Helper, danach 150–250 ms warten, erst dann Key-Event. `karaggeorge/mac-focus-window` macht genau das.

## 2. Screenshot-Capture des Kindle-Fensters

**Window-ID-Pfad (empfohlen)**: Swift-Helper nutzt `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)` → filtert nach `kCGWindowOwnerName == "Kindle"` und `kCGWindowLayer == 0` → liefert `kCGWindowNumber`. Dann:
```
screencapture -x -o -l<windowid> out.png
```
`-x` unterdrückt Shutter-Sound, `-o` weglassen wenn Fensterschatten unerwünscht. Läuft ohne Fokus-Wechsel, aber Fenster muss on-screen (nicht minimiert) sein.

**Node-Pakete**:
- `screenshot-desktop` — Vollbild, keine Window-Selektion → ungeeignet.
- `nashaofu/node-screenshots` — zero-dep, Mac/Win/Linux, unterstützt Window-Capture.
- `aslanon/node-mac-recorder` — moderner ScreenCaptureKit-Wrapper (macOS 12.3+), Window-Selektion, Overlay-Exclusion, MIT. Für Einzelframes Overkill, aber zuverlässig.
- `screencapturekit` / `capturekit` (npm) — dünne ScreenCaptureKit-Wrapper.
- `wulkano/aperture-node` — Fokus auf Video, nicht ideal für Still-Frames.

**Headless geht nicht.** Kindle rendert mit GPU-Pipeline; wenn das Fenster verdeckt oder minimiert ist, liefert `CGWindowListCreateImage` seit macOS 14 oft leeren oder veralteten Frame. ScreenCaptureKit kann mit `SCContentFilter` zwar verdeckte Fenster erfassen, aber die Rendering-Pipeline der Kindle-App pausiert teilweise bei Nicht-Sichtbarkeit. Fenster muss sichtbar sein — zweiter Monitor oder separater Space ist OK.

**Permission-Flow** (macOS 15+): `ScreenCaptureKit` löst TCC-Prompt beim ersten Capture-Call aus. Node-Pakete: `karaggeorge/mac-screen-capture-permissions` (`hasScreenCapturePermission`, `openSystemPreferences`). Reset via `tccutil reset ScreenCapture <bundleId>`. **Nicht skriptbar** — User muss einmalig im System-Settings-Pane die Checkbox setzen und die App neu starten. Gleiches gilt für Accessibility (`AXIsProcessTrusted`, `AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: true})`).

## 3. OCR-Qualität auf Kindle-Typografie

**Apple Vision `VNRecognizeTextRequest` ist die klare Wahl.** On-device, hohe Qualität auf sauber gerenderten Screenshots, unterstützt DE + EN nativ (`recognitionLanguages = ["de-DE", "en-US"]`). Modi:
- `.accurate` — ML-basierter Word/Line-Recognizer, langsamer, deutlich besser für Proportionalschrift wie Bookerly/AmazonEmber. **Pflicht für Fließtext.**
- `.fast` — Latin-Zeichen-Klassifizierer; deutsche Umlaute (ä/ö/ü/ß) werden laut Apple-Forum nur mit **deaktivierter** `usesLanguageCorrection` korrekt erkannt. Für Bücher nicht empfehlenswert.

Empfehlung: `.accurate` + `usesLanguageCorrection = true` + `automaticallyDetectsLanguage = true` (macOS 13+) + Sprachhinweise. Vision liefert `VNRecognizedTextObservation`-Objekte mit **Bounding-Boxen** — entscheidend für Layout-Rekonstruktion.

**Node-Bindings**:
- **`@cherrystudio/mac-system-ocr`** (aka `DeJeune/mac-system-ocr`) — napi-rs-Wrapper um Vision, liefert Observations mit Koordinaten + Confidence. Aktiv gepflegt (2024/2025), empfohlenes Paket.
- `bytefer/macos-vision-ocr` — Swift-CLI, JSON-Output mit Positionen; via `child_process` einbindbar, sehr stabil.
- `node-native-ocr` — generischer Wrapper, weniger Kontrolle.

**Tesseract** (`node-tesseract-ocr`, `tesseract.js`) liefert auf hochaufgelösten Screenshots ~89–94 % Accuracy, aber Proportionalfonts und Ligaturen machen Probleme. Gegenüber Vision erwartbarer Abstand von 5–15 Prozentpunkten Word-Error. Nur als OS-übergreifender Fallback sinnvoll.

**Layout-/Struktur-Rekonstruktion** ist der harte Teil. Pixel → Markdown braucht Heuristiken:
- **Absätze**: Vertikaler Gap zwischen Bounding-Boxen > 1,3× Zeilenhöhe → Absatz-Break.
- **Überschriften**: Box-Höhe signifikant > Median-Linienhöhe, oft zentriert → `#`/`##`.
- **Kursiv/Fett**: OCR liefert **keine** Style-Info. Zwei Optionen: (a) Ignorieren (Verlust akzeptieren), (b) pro Wort-Box aus dem Screenshot die Strichstärke/Schräglage per Bildverarbeitung (OpenCV/sharp) klassifizieren — fehleranfällig. Dritter Weg: Kindle-Schrift zwingen (Settings → Font = AmazonEmber, größte Größe, maximaler Zeilenabstand) und via Font-Heuristik unterscheiden, ob eine Box zu Regular/Italic/Bold-Glyph-Profil passt. Für saubere Markdown-Ausgabe realistisch nur eingeschränkt.
- **Zweispaltenlayout**: Bei Kindle-Büchern selten; Bounding-Box-X-Clustering (k-Means, k=1 vs k=2) unterscheidet.
- **Kopf-/Fußzeilen, Seitenzahl**: Filter per Y-Position (obere/untere 5–8 % des Fensters) und kurzer Text ohne Satzzeichen.
- **Silbentrennung**: Zeile endet mit `-` und nächste Zeile beginnt klein → Wort rekonstruieren.

## 4. Orchestrierung

**Ende-des-Buches-Detektion**: Kindle Mac hat im UI einen Fortschritts-Indikator („Loc 4231 of 5012" oder „87 %"). Drei Strategien, von gut nach brauchbar:
1. **AX-Walk nach Fortschrittstext**: oft als `AXStaticText` in der unteren Toolbar exponiert — günstigster Pfad, wenn verfügbar.
2. **OCR der Footer-Zone**: Deterministische Crop-Box, dedizierter schneller OCR-Call auf 100 × 30 px.
3. **Pixel-Hash-Vergleich**: Perceptual Hash (z. B. `sharp`+DCT) der letzten 2–3 Seiten; unverändert über 2 Umblätter-Zyklen → Ende. Fallback, aber bei statischen Endseiten („Über den Autor") falsch-positiv.

**Inhaltsverzeichnis / Kapitelsprünge**: `Cmd+T` öffnet TOC in Kindle Mac → einmalig am Anfang traversieren, Kapitel-Namen + Startpositionen merken. Während des Lesens: Seite OCRen, Text-Heuristik auf Kapitelmarker (Kapitel n, Prolog, Teil I …) plus Font-Größe → Markdown-Heading-Level.

**Rate-Limiting / Racing**. Pipeline pro Seite:
```
key-right  →  wait for render  →  screenshot  →  OCR (async)  →  dedupe
```
Render-Wait ist das Kernproblem. Saubere Lösung: nach Key-Event wiederholt Screenshots machen (10 ms Takt) und zwei aufeinanderfolgende Frames per Perceptual-Hash vergleichen — sobald stable für 150 ms, ist Seite fertig gerendert. Typischer Gesamtzyklus: 600–900 ms pro Seite, also ~4000 Seiten in ~50–60 Min. OCR kann in Worker-Pool parallel laufen (Vision nutzt ohnehin Neural Engine, 2–4 parallele Requests skalieren gut auf Apple Silicon).

**Dedup-Schutz**: gleicher Seiten-Hash nach Key-Right → Umblättern hat nicht funktioniert (Fokus verloren, Dialog, Highlight aktiv). Retry mit Focus-Reset.

## 5. Bekannte Projekte

- **[transitive-bullshit/kindle-ai-export](https://github.com/transitive-bullshit/kindle-ai-export)** (275★, TS). Playwright + **Kindle Cloud Reader** + GPT-4.1-mini-Vision statt klassischer OCR. WebGL-Rendering erfordert echten Browser (keine VM). Kein Mac-App-Bezug, aber das **bei weitem relevanteste Referenz-Projekt** für die NodeJS-Welt.
- **[raudette/kindleOCRer](https://github.com/raudette/kindleOCRer)** (Python, nur 2 Commits, wenig Aktivität). Selenium + Web-Reader + Marker-OCR + Pandoc → ePub.
- **[JPhilipp/Shortbook](https://github.com/JPhilipp/Shortbook)**. Windows-Kindle-App + Screenshots + OCR + GPT-4. Konzeptionell nächstes Äquivalent zum hier diskutierten Ansatz, nur auf Windows.
- **[0xrushi/KindleBookExporter](https://github.com/0xrushi/KindleBookExporter)**. Batch-Screenshot-Utility.
- **[tsunoda-s-ft/kindle-app](https://github.com/tsunoda-s-ft/kindle-app)**. Mac-Kindle-Automation mit ASIN/Layout/Position-Metadata — **prüfen, ob AX-Zugriff oder OCR**.
- **TextMuncher** (Chrome-Extension, kommerziell). Für Cloud Reader.
- Blog [hotelexistence.ca zu kindleOCRer](https://www.hotelexistence.ca/remove-drm-with-kindleocrer/) für Workflow-Erfahrung.

Weiterer Datenpunkt: Im Februar 2025 hat Amazon **„Download & Transfer via USB"** entfernt — der klassische Calibre-DeDRM-Weg ist für Neukäufe tot. Das erklärt, warum OCR-Ansätze 2025 wieder populär werden.

## 6. Recht / Privatsphäre / Permissions

**Rechtlich (DE)**: Umgehung wirksamer technischer Schutzmaßnahmen ist nach § 95a UrhG problematisch. OCR eines sichtbaren Fenster-Bildschirms ist **nicht** eine „Umgehung" im strengen Sinne (der Text wird vom legalen Client gerendert) — die h. M. in einschlägigen Foren wertet es als Privatkopie nach § 53 UrhG, solange (a) eigenes legal erworbenes Buch, (b) keine Weitergabe, (c) kein technischer Schutz gebrochen wird. **Keine Rechtsberatung**; im Zweifel Anwalt.

**macOS-Permissions (nicht skriptbar, aber vorhersehbar)**:
- **Accessibility** (`AXIsProcessTrustedWithOptions`): TCC-Prompt beim ersten `CGEventPost`/AX-Call. User muss `node`/Terminal/Electron-Host in *Settings → Privacy & Security → Accessibility* freischalten. Nach Freischaltung App-Neustart. Reset: `tccutil reset Accessibility <bundleId>`.
- **Screen Recording**: analog, für `CGWindowListCreateImage`/`SCStream`/`screencapture -l`. Ohne diese Permission liefert Capture in macOS 15+ nur Desktop-Hintergrund statt Fensterinhalt.
- **Apple-Events** (`NSAppleEventsUsageDescription`): nötig für `System Events`-Keystrokes via osascript.
- **Input Monitoring**: nicht erforderlich für ausgehende Events (nur für Event-Taps auf eingehende).

Beim ersten Start: Best-Practice-Flow im Node-CLI → `mac-screen-capture-permissions.hasScreenCapturePermission()` + `macos_accessibility_client.applicationIsTrustedWithPrompt()` aufrufen, bei `false` User-facing-Guide ausgeben und Exit. Nach User-Klick in Settings: App neu starten (TCC-Grants greifen prozessweit erst nach Restart).

---

## Paket-/Tool-Liste mit Status

| Baustein | Empfehlung | Backup |
|---|---|---|
| AppleScript-Dict | — (nicht vorhanden) | — |
| AX-Permission | `macos_accessibility_client` (napi-rs, Apache-2.0) | `node-mac-permissions` |
| AX-Tree-Walk | **eigener Swift-CLI-Helper** | `Igalia/acacia` |
| Keyboard-Events | Swift-CLI via `CGEventPost` | osascript `System Events` |
| Window-Focus | `karaggeorge/mac-focus-window` | eigener Swift-Helper |
| Window-Enumeration | Swift-CLI `CGWindowListCopyWindowInfo` | — |
| Screenshot | `screencapture -l<id>` via `child_process` | `nashaofu/node-screenshots`, `aslanon/node-mac-recorder` |
| ScreenRec-Permission | `karaggeorge/mac-screen-capture-permissions` | manuell |
| OCR | **`@cherrystudio/mac-system-ocr`** oder `bytefer/macos-vision-ocr` (Swift-CLI) | `node-tesseract-ocr` |
| Pixel-Diff / Hash | `sharp` + eigener pHash | `looks-same` |
| Markdown-Ausgabe | eigener Layout-Analyzer + `turndown` | — |

## Einschätzung — ist saubere Markdown-Ausgabe realistisch?

**Text-Genauigkeit**: Ja. Apple Vision `.accurate` auf 2×-Retina-Screenshots der Kindle-App liefert für deutsche Prosa in Bookerly/AmazonEmber realistisch **>99 %** Zeichen-Genauigkeit. Das ist für Lektüre-Tauglichkeit ausreichend; Nachkorrektur via LLM-Pass (optional) schließt die Lücke.

**Strukturtreue**: Eingeschränkt. Absätze und Überschriften lassen sich aus Bounding-Box-Geometrie solide rekonstruieren. **Kursiv/Fett gehen in der reinen OCR-Pipeline verloren** — das ist der wunde Punkt für "sauberes Markdown". Workaround: Glyph-Level-Bildklassifikation (Regular vs. Italic anhand Schräglage) per kleinem CV-Classifier, erreicht ~90 % Precision — genug, um Betonungen zu kennzeichnen, nicht genug für Fachliteratur mit semantisch wichtigen Auszeichnungen.

**Fußnoten, Tabellen, Bilder, Formeln, Code-Blöcke**: schwach. Tabellen werden zu Text-Wüsten, Formeln zu OCR-Müll, eingebettete Bilder gehen verloren (müssten separat aus Screenshot gecroppt werden).

**Robustheit der Automation**: Mittel. Fokus-Verlust, Popup-Dialoge, „Jump to last read position"-Hints, Sync-Fortschritt-Banner — all das braucht Error-Recovery. Realistisch ~95 % der Seiten beim ersten Durchlauf erfolgreich, Rest über Retry-Schleife.

**Gesamtfazit**: Für **Fließtext-lastige Belletristik/Sachbuch in DE oder EN** ist die Pipeline **realistisch und liefert brauchbare Markdown-Ausgabe** (Haupttext + Kapitelstruktur + Absätze, ohne feine Auszeichnungen). Für **Fachliteratur mit Formeln, Tabellen, Code, komplexer Typografie** ist sie **zu fragil** — hier lohnt sich eher ein Umweg über Kindle Cloud Reader mit DOM-Extraktion (siehe kindle-ai-export) oder die Investition in die DRM-Route.

**Konkreter Architektur-Vorschlag**: Haupt-Pipeline in TypeScript, ein dünner **Swift-CLI-Helper** (Single Binary, ~300 LOC) kapselt alles, was native macOS-APIs braucht (AX-Query, CGEventPost, Window-Enum, Screen-Capture, Vision-OCR). Node-Seite orchestriert via `child_process`, macht Markdown-Assembly, Dedup, Retry. Deutlich wartbarer als ein Sammelsurium von npm-Paketen mit je eigener napi-Drift.

---

## Quellen

- [transitive-bullshit/kindle-ai-export (GitHub)](https://github.com/transitive-bullshit/kindle-ai-export)
- [raudette/kindleOCRer (GitHub)](https://github.com/raudette/kindleOCRer)
- [JPhilipp/Shortbook (GitHub)](https://github.com/JPhilipp/Shortbook)
- [0xrushi/KindleBookExporter (GitHub)](https://github.com/0xrushi/KindleBookExporter)
- [tsunoda-s-ft/kindle-app (GitHub)](https://github.com/tsunoda-s-ft/kindle-app)
- [ahkohd/macos_accessibility_client (GitHub)](https://github.com/ahkohd/macos_accessibility_client)
- [Igalia/acacia (GitHub)](https://github.com/Igalia/acacia)
- [DeJeune/mac-system-ocr (GitHub)](https://github.com/DeJeune/mac-system-ocr) / [npm](https://www.npmjs.com/package/@cherrystudio/mac-system-ocr)
- [bytefer/macos-vision-ocr (GitHub)](https://github.com/bytefer/macos-vision-ocr)
- [aslanon/node-mac-recorder (GitHub)](https://github.com/aslanon/node-mac-recorder)
- [nashaofu/node-screenshots (GitHub)](https://github.com/nashaofu/node-screenshots)
- [karaggeorge/mac-screen-capture-permissions (GitHub)](https://github.com/karaggeorge/mac-screen-capture-permissions)
- [karaggeorge/mac-focus-window (GitHub)](https://github.com/karaggeorge/mac-focus-window)
- [Apple Vision — VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [Apple Vision WWDC21 — Document Data Extraction](https://developer.apple.com/videos/play/wwdc2021/10041/)
- [Apple Dev Forum — German umlauts and fast-path recognition](https://developer.apple.com/forums/thread/121048)
- [Kindle for Mac Keyboard Shortcuts (Amazon)](https://www.amazon.com/gp/help/customer/display.html?nodeId=GFBT6Y7AFLJY947N)
- [Accessibility Permission in macOS (jano.dev, Jan 2025)](https://jano.dev/apple/macos/swift/2025/01/08/Accessibility-Permission.html)
- [Hotel Existence — kindleOCRer workflow](https://www.hotelexistence.ca/remove-drm-with-kindleocrer/)
- [TextMuncher Blog — Kindle Cloud Reader copy methods (2026)](https://textmuncher.com/blog/copy-text-kindle-cloud-reader)
