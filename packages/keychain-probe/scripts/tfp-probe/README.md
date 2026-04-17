# TFP-Probe — empirisches `task_for_pid`-Verhalten auf macOS

Dieses Minimal-Experiment beantwortet eine einzige Frage: reicht ein **ad-hoc signiertes** oder **Apple-Developer-ID signiertes** Binary mit der public-Entitlement `com.apple.security.cs.debugger`, um unter SIP=on auf macOS 26 einen laufenden Third-Party-Produktions-Prozess (Hardened Runtime, `get-task-allow=false`) mit `task_for_pid` zu öffnen?

Wenn **nein** → Apples Dev-ID-Weg ist keine praktikable Alternative zu SIP-off-Enrollment.
Wenn **ja** (egal in welcher Variante) → Aufwand für Apple Developer Program + Notarization wäre gerechtfertigt.

## Drei Varianten

| Variante | Entitlement(s) | Erwartung |
|---|---|---|
| `probe-bare` | keine | Fail (KERN_FAILURE) — ohne Entitlement niemals |
| `probe-debugger` | `com.apple.security.cs.debugger = true` | offen — das ist die Hypothese, die der Test entscheidet |
| `probe-debugger-gta` | debugger + `get-task-allow = true` | Referenz — gta auf der Caller-Seite hat klassisch keinen Effekt auf TFP, sollte also wie `probe-debugger` reagieren |

## Build

```bash
cd packages/keychain-probe/scripts/tfp-probe
make
```

Das kompiliert und ad-hoc-signiert alle drei Varianten. Keine Apple-Developer-Credentials nötig — ad-hoc Signatur reicht für die öffentlichen Entitlements.

## Ausführung

1. Kindle App starten, ein Buch im Reader öffnen (damit die App stabil läuft — Anti-Debug beim Kaltstart).
2. PID holen:
   ```bash
   PID=$(pgrep -x Kindle)
   echo "Kindle PID: $PID"
   ```
3. Alle drei Varianten nacheinander:
   ```bash
   make run-all PID=$PID
   ```
4. Ergebnis dokumentieren — je Variante zeigt die Ausgabe entweder `SUCCESS` oder `task_for_pid(<pid>) failed: kr=0x... (<message>)`.

## Interpretation

### Wenn `probe-bare` und `probe-debugger` beide fehlschlagen

Dann bestätigt sich unsere Hypothese: auf macOS 26 + Apple Silicon wird `task_for_pid` für `get-task-allow=false`-Apps auf Kernel-Ebene blockiert, **unabhängig von der Caller-Entitlement**. In dem Fall:
- Apple-Dev-ID-Signing ist keine Lösung.
- Einzige Option für Enrollment bleibt SIP-off.

### Wenn `probe-debugger` erfolgreich ist

Dann:
- Dev-ID-Signing + cs.debugger-Entitlement ist eine echte Alternative.
- Aufwand: 99 $/Jahr für Apple Developer Program + Notarization pipeline.
- Apple reviewt restricted Entitlements manuell; für eine "Kindle decrypt"-Begründung ist eine Ablehnung realistisch. Aber technisch wäre der Hebel verfügbar.

### Wenn nur `probe-debugger-gta` erfolgreich ist

Unwahrscheinlich, aber hätte eigene Konsequenzen (caller-side `get-task-allow` als zusätzlicher Schlüssel).

## Cleanup

```bash
make clean
```

## Einordnung in die Gesamt-Architektur

Das Ergebnis entscheidet nur über den **Enrollment-Pfad**. Die Runtime-Entschlüsselung (Phase 3–5) ist davon unberührt — die liest `keys.json` und funktioniert auf jedem macOS.
