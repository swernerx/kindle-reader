# Onboarding — zweite Maschine (Verifikation SIP=on + TCC Developer Tools)

Dieses Dokument richtet sich an eine Nachfolge-Session auf einer zweiten Maschine. Ziel: empirisch bestätigen, dass die in Phase 2c gebaute Enrollment-Pipeline **ohne Deaktivieren von SIP** funktioniert, sobald das aufrufende Terminal die TCC-Permission **"Developer Tools"** erhalten hat.

Sekundäres Ziel: einen ersten End-to-End-Lauf gegen ein Buch durchführen und die Ergebnisse der Checkliste in `docs/21-enrollment.md` dort festhalten.

## Voraussetzungen auf der neuen Maschine

- macOS (Apple Silicon empfohlen; x86_64 sollte ebenso funktionieren, nicht getestet)
- **SIP aktiv** — `csrutil status` muss `System Integrity Protection status: enabled.` ausgeben
- Xcode Command Line Tools installiert: `xcode-select --install`, danach `lldb --version` erreichbar
- Node.js ≥ 20 + `corepack enable` (pnpm wird über corepack bereitgestellt)
- Amazon Kindle (Lassen) installiert und **mit demselben Amazon-Account** authentifiziert, unter dem die Bücher gekauft wurden. Mindestens ein KFX-Buch heruntergeladen.
- SSH-Key beim GitHub-Account des Owners `swernerx` eingetragen (für `git clone`)

## 1. Repo klonen und Dependencies installieren

```bash
git clone git@github.com:swernerx/kindle-reader.git
cd kindle-reader
corepack enable
pnpm install
pnpm -r build
```

Erwartung: alle fünf TypeScript-Pakete bauen grün durch (`catalog`, `drmion`, `kfx-parser`, `exporter`, `keychain-probe`). Das Swift-Subpaket in `packages/keychain-probe/` wird für den TCC-Test **nicht** gebraucht — es ist ein früherer Stufe-Check.

Falls `better-sqlite3` beim `pnpm install` mit Compile-Fehler abbricht, prüfen ob die Xcode CLT aktuell sind (`xcode-select -p` zeigt einen Pfad, `gcc --version` antwortet).

## 2. Katalog-Sanity-Check

```bash
pnpm --filter @kindle/catalog build
node packages/catalog/dist/cli.js --verbose
```

Erwartete Ausgabe: Liste der heruntergeladenen KFX-Bücher auf diesem Mac mit Titel, ASIN, Fortschritt, Bundle-Pfad. Wenn hier null Bücher auftauchen, ist entweder die Kindle-App nicht richtig installiert oder kein Buch heruntergeladen (KFX-Format).

Notiere dir die ASIN eines Ziel-Buchs — wir nehmen im nächsten Schritt.

## 3. Kindle starten und Buch öffnen

**Wichtig: das Buch muss im Reader geöffnet sein**, nicht nur in der Library-Kachelansicht. Lassen lädt den AES-Content-Key lazy, erst beim ersten Page-Rendering.

```bash
open "/Applications/Amazon Kindle.app"
```

→ Manuell auf das Buch klicken, bis der Reader sichtbar ist.

## 4. Ergebnis der SIP=on-Tests (2026-04-17, macOS 26.3.1 Apple Silicon)

**Alle SIP=on-Wege sind empirisch ausgeschlossen.** Beide Tests haben durchgelaufen:

1. **TCC "Developer Tools" + Apple `debugserver`**: `task_for_pid` scheitert mit `KERN_FAILURE (0x5)` nach ~1 ms, **ohne** dass tccd überhaupt konsultiert wird. Kernel-Early-Reject.
2. **Ad-hoc signiertes Binary mit public `com.apple.security.cs.debugger` Entitlement**: identischer Fehler — AMFI entfernt die restricted Entitlement bei nicht-Apple-legitimierten Signaturen.

Detaillierter Befund: `docs/30-decisions.md` ADR-006.

**Konsequenz**: Enrollment benötigt **SIP deaktiviert** während der Extraktion:

```bash
# 1. In Recovery-Mode starten (Apple Silicon: Power-Taste gedrückt halten beim Start)
# 2. Terminal öffnen aus dem Recovery-Utilities-Menü
csrutil disable
# 3. Reboot, normales Login
# 4. Kindle starten, alle zu enrollenden Bücher nacheinander öffnen
node packages/keychain-probe/dist/cli.js enroll <ASIN-1>
node packages/keychain-probe/dist/cli.js enroll <ASIN-2>
# ... für jedes Buch, kann in einer Session gemacht werden
# 5. Reboot in Recovery, `csrutil enable`, reboot
```

Runtime (Phase 3+) braucht SIP-off dann nicht mehr.

## 4.1 (historisch, für Dokumentation) Das ursprüngliche TCC-Experiment

**Variante A** — ohne TCC-Freischaltung probieren (Referenz-Experiment; erwartet Fehlschlag):

```bash
node packages/keychain-probe/dist/cli.js enroll <ASIN>
```

Erwartet: Entweder "lldb exited with status ... / Operation not permitted" oder ein Crash der Kindle-App. Dokumentiere die genaue Fehlermeldung.

**Variante B** — TCC "Developer Tools" freischalten:

1. System Settings öffnen → Privacy & Security → **Developer Tools**.
2. Falls der Schalter für Terminal/iTerm noch nicht gelistet ist: der erste Attach-Versuch triggert normalerweise einen Prompt "Terminal wants to run a tool that needs to attach to other processes". Bestätigen, damit Terminal in die Liste wandert.
3. Schalter für Terminal (oder welches Terminal du benutzt) **auf ein**.
4. **Terminal komplett schließen und neu öffnen.** TCC-Grants greifen prozessweit erst nach Neustart. Ohne Neustart sehen weiterhin alle Aufrufe die alten Policy-Daten.

Dann erneut:

```bash
cd /Pfad/zum/kindle-reader
node packages/keychain-probe/dist/cli.js enroll <ASIN>
```

**Erwartung (falls TCC ausreicht)**:

```
book: <Titel> (<ASIN>)
ciphertext spec: AES/CBC/PKCS5Padding  content-key=amzn1.drm-key.v1.<uuid>  chunks=5
kindle pid: <pid>
dumping writable heap (small regions only) via lldb...
dump: /var/folders/.../small.bin  ~235 MiB (7s)
brute-forcing AES key against 5 (ct, iv) pairs...
key found: offset=0x... bits=128  key=<hex>  preview=005d000040000028...
saved to ~/.config/kindle-extractor/keys.json
✓ enrolled <ASIN> — key amzn1.drm-key.v1.<uuid>... in ~33s
```

**Falls TCC nicht reicht**, erwartete Fehlermuster:
- `lldb: Attaching to process <pid>...` ohne Stop — Prozess wird blockiert von AMFI
- `error: attach failed: lost connection`
- `error: attach failed: Operation not permitted`

In diesem Fall ist TCC alleine **nicht** ausreichend. Dann wäre die nächste Stufe: Apple-Developer-signiertes Binary mit `com.apple.security.cs.debugger`-Entitlement. Oder pragmatisch SIP für den Enrollment-Zeitraum vorübergehend off.

## 5. Ergebnis dokumentieren

Egal wie der Test ausgeht, bitte in `docs/00-state.md` einen neuen Verlaufseintrag ergänzen und in `docs/21-enrollment.md` die Tabelle am Ende ausfüllen. Zwei Commits (oder einer), Conventional Commits style, pushen.

Wenn der Test erfolgreich war: Changelog-Hinweis in `docs/30-decisions.md` ADR-006 auf "Verifiziert SIP=on + TCC" upgraden.

## 6. Weitere Schritte in der Session

Falls Enrollment erfolgreich ist, kann die Session direkt weiter nach vorne:
- **Phase 3** (`@kindle/drmion.decryptBook`): Runtime-Entschlüsselung ohne LLDB. Nimmt die `keys.json` und `.azw8` zur Hand, dekrypt + LZMA-dekomprimiert chunks.
- **Phase 4** (`@kindle/kfx-parser`): Ion-Symbol-Tabelle aus MobileRead-Wiki + jhowell's KFX Input Plugin portieren; strukturierter Buch-Content.
- **Phase 5** (`@kindle/exporter`): Markdown + ePub-Emitter.

Der Plan für all das liegt in `~/.claude/plans/ich-w-rde-gerne-eine-happy-mccarthy.md` (auf der ersten Maschine); der Inhalt wurde aber in diese Repository-Docs übernommen (siehe `docs/`).

## 7. Für den AI-Kollegen — direkte Hinweise

- Rechtliche Scope-Grenze steht in `docs/99-legal.md`. Keine Veröffentlichung von Schlüsseln, Forks oder binärem Output.
- Arbeitsweise-Präferenzen: Conventional Commits, kurzstufige commits als Rollback-Anker, jede Designentscheidung in `docs/30-decisions.md` als ADR, Live-Stand in `docs/00-state.md` nach jedem Meilenstein aktualisieren.
- Scope: **ausschließlich** die 5 KFX-Bücher (`application/x-kfx-ebook` + `ZRAWBOOKSTATE = 3`). Mobipocket-Altbestand und Audible bleiben ausgeblendet.
- Zwei Forschungsberichte als Hintergrund in `docs/11-drmion-format.md` und `docs/12-ui-ocr-fallback.md`. **Der UI-OCR-Pfad ist explizit abgelehnt** vom Nutzer und soll nicht erneut vorgeschlagen werden.

Falls unklar: kurze Frage an den Nutzer stellen, nicht annehmen.
