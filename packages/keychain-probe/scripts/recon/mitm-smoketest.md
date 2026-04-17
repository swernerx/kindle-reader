# MITM Smoketest — grenze ab, ob Kindle-App Certificate Pinning macht

Ziel: **kein Re-Login**, **kein Kindle-Zustand-Verlust**. Wir schalten einen HTTPS-Proxy zwischen Lassen und Amazon, installieren das Proxy-CA-Zertifikat systemweit und beobachten, was passiert, wenn die App ihren üblichen Sync-Traffic fährt.

## Was wir lernen wollen

- **Akzeptiert** Lassen das MITM-Zertifikat? → kein Pinning, HTTPS-Payloads lesbar. Riesenchance.
- **Verweigert** Lassen die Verbindung oder bringt spezielle TLS-Fehler? → Pinning aktiv, MITM-Route tot.
- Welche Endpunkte (Host + Path) werden überhaupt angesprochen?

## Setup (auf dem SIP=on Test-Mac ausführbar)

### 1. mitmproxy installieren

```bash
brew install mitmproxy
```

### 2. mitmproxy einmal laufen lassen, damit es seine Root-CA erzeugt

```bash
# Terminal 1
mitmproxy
```

Das legt bei erstem Start `~/.mitmproxy/mitmproxy-ca-cert.pem` an. Mitmproxy UI mit `q` beenden.

### 3. Die CA systemweit vertrauenswürdig machen

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem
```

### 4. System-HTTP-Proxy auf den mitmproxy legen

System Settings → Network → (Wi-Fi oder Ethernet) → Details → Proxies:
- **Web Proxy (HTTP)**: `127.0.0.1 : 8080` aktivieren
- **Secure Web Proxy (HTTPS)**: `127.0.0.1 : 8080` aktivieren

(Oder via CLI mit `networksetup -setsecurewebproxy`)

### 5. mitmweb im Hintergrund starten

```bash
mitmweb --listen-port 8080
```

Web UI öffnet sich auf `http://127.0.0.1:8081`. Dort sieht man live alle HTTPS-Calls.

### 6. Kindle-App starten und ein bisschen interagieren

- Buch öffnen
- Ein paar Seiten vorblättern
- Notiz setzen (Sync triggern)
- Beenden

### 7. Ergebnis beobachten

In der mitmweb-Oberfläche:
- Wird **jede** Verbindung mit einem TLS-Fehler rot markiert? → Cert-Pinning aktiv → MITM-Route gescheitert.
- Gehen manche Verbindungen (Sync, Whispersync, API) durch und nur DRM/License-Endpunkte sind rot? → **Selektives Pinning**, der DRM-Pfad schützt sich, der Rest ist offen. Dann wissen wir wenigstens genau, was wir noch angehen müssen.
- Gehen **alle** Verbindungen durch? → kein Pinning, wir können in aller Ruhe API-Calls inspizieren und die DRM-Endpunkte identifizieren.

## Aufräumen (sehr wichtig!)

```bash
# HTTPS-Proxy wieder aus
# System Settings → Network → Proxies → beide Haken raus

# CA wieder aus dem System-Keychain nehmen
sudo security delete-certificate -c "mitmproxy" /Library/Keychains/System.keychain
```

Ohne den Cleanup würde jeder zukünftige HTTPS-Traffic durch den (dann nicht mehr laufenden) mitmproxy gehen und nur Fehler werfen. Also den Proxy **immer** deaktivieren, bevor man das Experiment beendet.

## Erwartung

Amazon verwendet bei vielen Endpunkten Pinning (insb. `/api/drm/*`, DRM-Voucher-Refresh). Pure App-Sync, Telemetrie und Whispersync sind oft ungepinnt. Wenn wir Glück haben, geht der für uns interessante Voucher-Update-Endpunkt durch.

**Falls alles gepinnt ist**: Weiterer Plan B wäre, die Kindle-Binary-Pinning-Implementation einmalig auf einem SIP=off-Mac zu analysieren und einen statischen Dylib-Patcher zu schreiben (`codesign --remove-signature` + ggf. re-sign; braucht SIP=off nur für die RE-Session, nicht für die Anwendung). Das würde ich nur angehen, wenn der Smoketest klar zeigt, dass Pinning das einzige verbleibende Hindernis ist.
