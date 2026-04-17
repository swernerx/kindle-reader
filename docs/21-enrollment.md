# Phase 2c — Enrollment Pipeline

Einmalige Extraktion pro Buch des AES-Content-Keys aus der laufenden Lassen-App. Ergebnis: `~/.config/kindle-extractor/keys.json`. Nachgelagerte Pakete (Phase 3 DRMION-Entschlüsselung, Phase 4 KFX-Parser, Phase 5 Export) benötigen **nur** diese Datei und die Original-`.azw8`-Dateien aus dem Lassen-Container; sie laufen ohne LLDB und ohne Keychain-Zugriff.

## Ablauf

```
$ kindle-enroll enroll <ASIN>
```

Was der Befehl tut:

1. Liest den Bundle-Pfad des Buchs aus `BookData.sqlite` (via `@kindle/catalog`).
2. Öffnet die `.azw8`-Datei als DRMION-Ion-Stream, extrahiert die ersten 5 `(ciphertext, iv)`-Paare + Metadaten (Content-Key-UUID, Cipher-Spec).
3. Findet den laufenden Kindle-Prozess (`pgrep`).
4. Startet `lldb --batch -p <pid>` mit dem Python-Skript `dump_small.py`, das alle **writeable** Memory-Regionen ≥ 4 KiB und ≤ 4 MiB in eine einzelne Datei (`small.bin`) konkateniert und einen `small.index` (offset → virtuelle Adresse) schreibt. Typische Größe: 200–250 MiB.
5. Läuft Offline-Brute-Force: schiebt mit Stride 8 ein 16/24/32-Byte-Fenster durch den Dump und versucht, **jedes der 5 Ciphertext-Paare** mit diesem Fenster als AES-CBC-PKCS5-Schlüssel zu entschlüsseln. Nur Kandidaten, die bei **allen 5** Paaren valide PKCS7-Padding-Struktur liefern, zählen als Treffer. False-Positive-Rate: effektiv 0 (\(\ll 10^{-10}\)).
6. Speichert `{asin, keyUuid, keyHex, bits, extractedAt}` in `keys.json` (`mode 0600` + Parent-Dir `0700`).

**Laufzeit**: ~30 Sekunden End-to-End (7 s Dump + 25 s Brute-Force auf Apple Silicon, ~0.3 M Kandidaten/s × 5-Chunk-Validator).

## Voraussetzungen

- Xcode Command Line Tools (`/usr/bin/lldb` erreichbar, Apple-signiertes `debugserver`).
- Das Zielbuch muss in Lassen **geöffnet** sein (Reader-Ansicht, nicht nur im Library-Grid). Lassen lädt den Content-Key lazy beim ersten Page-Rendering.
- **Einer der folgenden System-Zustände**:
  - SIP deaktiviert (macOS Recovery → `csrutil disable` → Reboot), **oder**
  - TCC-Permission **"Developer Tools"** ist für das aufrufende Terminal freigeschaltet (System Settings → Privacy & Security → Developer Tools → Terminal).

Kein Apple-Developer-Account, keine Entitlements für unser Binary, keine Keychain-AppGroup-Berechtigung nötig. Wir nutzen ausschließlich Apples eigenen `debugserver`, der bereits mit `com.apple.private.cs.debugger` signiert ist.

## Datei-Formate (empirisch verifiziert)

### `.azw8` / `.azw9.res` / `.azw9.md` (DRMION-Container)

```
Offset 0x00  | 8 Byte Magic: EA 44 52 4D 49 4F 4E EE  ("\xeaDRMION\xee")
Offset 0x08  | Amazon Ion Binary 1.0-Stream
             |
             |   list [
             |     struct (metadata):
             |       int    102400                               # chunk size
             |       int     10240                               # sub-chunk size
             |       string "amzn1.drm-key.v1.<uuid>"           # content key
             |       string "AES/CBC/PKCS5Padding"
             |       string "amzn1.drm-voucher.v1.<uuid>"
             |       string "amzn1.drm-key.v1.<uuid>"           # signature key
             |       string "SHA256withRSA"
             |       string "amzn1.drm-voucher.v1.<uuid>"       # repeated
             |       string "LZMA"
             |
             |     struct: { blob ciphertext, blob iv-16 }
             |     struct: { blob ciphertext, blob iv-16 }
             |     ...
             |     struct: { blob signature }
             |   ]
             |
             |   (possibly more top-level lists, each with its own metadata)
```

**Chunk-Format nach AES-CBC-Entschlüsselung**:

```
Byte 0     : 0x00      flag
Byte 1     : 0x5D      LZMA-alone properties byte (lc=3, lp=0, pb=2)
Byte 2-5   : 00 00 40 00  dict size (4 MiB, little-endian)
Byte 6-13  : 00 28 00 00 00 00 00 00  uncompressed size (10240, LE)
Byte 14-   : LZMA-compressed payload
```

Nach LZMA-Dekompression: exakt 10 240 Bytes rohes Material. Die ersten 4 Bytes "CONT" oder Ion-BVM, abhängig davon, ob es sich um ein Metadaten-Kapitel oder einen Inhalts-Chunk handelt.

### Voucher (`amzn1.drm-voucher.v1.<uuid>.voucher`, 1166 Byte)

Amazon Ion Binary 1.0. Outer struct:

```
struct {
  struct {                                        # algorithm-spec
    list [ "ACCOUNT_SECRET", "CLIENT_ID" ]        # named key-derivation inputs
    "AES"
    "AES/CBC/PKCS5Padding"
    "HmacSHA256"
  }
  blob (32)    # HMAC-SHA256 tag
  blob (1007)  # ciphertext: inner Ion doc with per-book content key + ATV-Purchase token
}
```

`ACCOUNT_SECRET` und `CLIENT_ID` sind **Namen**, die Werte liegen anderswo (Keychain AppGroup `J7P34ALZ5R.com.amazon.Lassen`). Für unser Extraktions-Vorgehen **irrelevant** — wir holen uns den bereits decodeten Content-Key direkt aus dem App-Heap, statt den Voucher selbst zu entschlüsseln.

## Warum dieser Ansatz robust ist

Drei unabhängige Signale bestätigen den Treffer:

1. **PKCS7 auf 5 Chunks**: Padding-Validierung bei allen 5 Ciphertext-Paaren auf denselben Key gleichzeitig.
2. **LZMA-Alone-Header im Plaintext**: jedes Chunk beginnt nach Entschlüsselung mit `00 5D 00 00 40 00 00 28 00 00 00 00 00 00 00` — literal byte-identisch.
3. **Dekompression liefert exakt 10 240 Bytes**: die im Metadata-Struct angegebene sub-chunk-size.

Alle drei Signale unabhängig prüfen bedeutet: ein falscher Kandidat müsste (1) × (2) × (3) erfüllen, praktisch ausgeschlossen.

## Anti-Debug-Verhalten der Lassen-App

Beim Kaltstart hat die App eine Heuristik, die LLDB-Attach mit einem Crash beantwortet. **Stabil** wird der Attach, sobald ein Buch geöffnet ist (Reader-Ansicht). Daher immer so vorgehen:

1. Kindle starten
2. Ein Buch öffnen (Reader-View)
3. `kindle-enroll enroll <asin>` aufrufen

## Test-Checklist für SIP=on + TCC Developer Tools

> **Zweck**: empirisch bestätigen, dass die Enrollment-Pipeline auf einem stock-macOS mit aktivem SIP funktioniert, sofern die TCC-Permission "Developer Tools" für das Terminal freigeschaltet ist.
>
> Diese Checklist ist für eine andere Test-Session (auf einem zweiten Mac oder nach Re-Enable von SIP auf diesem Mac) gedacht.

### Vorbereitung

1. **SIP-Status prüfen**: `csrutil status` → `System Integrity Protection status: enabled.`
2. **Xcode Command Line Tools installiert**: `xcode-select -p` → nicht leer, `lldb --version` antwortet.
3. **Lassen/Kindle installiert**, Account authorisiert, mindestens ein Buch heruntergeladen.
4. **Dieses Repo geklont** und `pnpm install && pnpm -r build` erfolgreich.

### TCC freischalten

1. System Settings → Privacy & Security → **Developer Tools**.
2. Falls die Liste leer ist: der nächste Schritt erzeugt einen Prompt, der Terminal (oder iTerm etc.) hinzufügt.
3. **Terminal.app einhaken** und Toggle **ein**.
4. Terminal einmal **neu starten** (TCC-Grants greifen prozessweit erst nach Restart).

### Run

```bash
# 1. Kindle starten, Buch öffnen (Reader View)
open "/Applications/Amazon Kindle.app"
# → manuell ein Buch anklicken, bis Reader sichtbar

# 2. ASIN aus Catalog identifizieren
pnpm --filter @kindle/catalog start

# 3. Enrollment
node packages/keychain-probe/dist/cli.js enroll <ASIN>
```

### Erwartetes Verhalten

| Fall | Ausgang |
|---|---|
| **Erfolg** | `✓ enrolled <ASIN> ... in XXs` — TCC-Hypothese bestätigt |
| `lldb exited with status ...: Attaching to process 1234 failed.` / `Operation not permitted` | TCC-Permission war doch nicht ausreichend — dann ist der TCC-Weg **nicht** tragfähig, wir müssen SIP-off für Enrollment fordern |
| `dump_small.py completed but dump not found` | Kindle hat beim Attach gecrasht (Anti-Debug). Kindle neu starten, Buch öffnen, erneut probieren |
| `no AES key found in dump` | Buch war nur in Library-Ansicht, nicht geöffnet. Reader-View erzwingen |

### Kompetenz-Grenzen der TCC-Hypothese

Mit TCC "Developer Tools" wird `task_for_pid` auf `get-task-allow=false`-Apps freigeschaltet, **solange** die Ziel-App nicht zusätzliche Absicherungen fährt wie:

- `com.apple.security.cs.debugger-allowed = false` (Lassen hat das nicht explizit gesetzt → default true ok)
- `Hardened Runtime` + `Library Validation` (Lassen hat's an, verhindert aber nur Injection, nicht Attach + Memory-Read)
- `pthread_introspection_*` Hooks zur Laufzeit-Selbstverteidigung (wurde bei iOS-Versionen von Kindle beobachtet, aber nicht in Lassen für macOS bestätigt)

Falls der Test fehlschlägt und der Fehler explizit auf die Entitlements oder AMFI-Policy verweist, ist die einzige Alternative tatsächlich SIP-off — das aber nur einmalig für den Enrollment-Zeitraum.

### Aufräumen nach dem Test

Falls gewünscht kann die TCC-Freigabe wieder zurückgenommen werden (gleicher Settings-Pane, Toggle aus). `keys.json` bleibt unverändert und wird weiterhin ohne Spezialrechte von der Runtime gelesen.
