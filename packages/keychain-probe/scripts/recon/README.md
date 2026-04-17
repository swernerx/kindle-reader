# Recon — SIP-freier Angriffsweg

Nachdem sich sowohl TCC "Developer Tools" als auch ad-hoc `cs.debugger`-Entitlement als kernel-seitig blockiert herausgestellt haben (siehe ADR-006), bleibt als SIP-freier Zugang nur der **Netzwerk-Pfad**: Lassen talkt mit Amazon für Auth / DRM-License / Sync. Wenn diese Kommunikation interceptable ist, sehen wir vielleicht den ACCOUNT_SECRET oder die per-Book-Keys vom Server kommen.

Dieses Verzeichnis sammelt die passiven Recon-Werkzeuge. Alle laufen auf SIP=on ohne Spezialrechte (außer `sudo` für FS-Tracing).

## Skripte

### `fs-trace.sh`

Wrapper um `fs_usage`, tracest alle File-System-Operationen der Kindle-App.

```bash
# Terminal 1 — tracing
cd packages/keychain-probe/scripts/recon
./fs-trace.sh trace
# (in Kindle Aktionen ausführen: App starten, Buch öffnen, Seiten umblättern, Notiz, Schließen)
# Ctrl-C hier

# Terminal 2 — Analyse
./fs-trace.sh summary
```

Interessant wären:
- Writes in `/tmp` oder `/var/folders` beim Buchöffnen → temporäre Plaintext-Caches?
- Files mit "key", "voucher", "drm" in Pfaden außerhalb des Lassen-Containers
- Plötzliche Writes in die Data-Protection-Keychain (`keychain-2.db*`) beim Buchöffnen → Hinweis auf Key-Refresh-Flow

### `net-observe.sh`

Zeigt welche Remotes Kindle aktuell kontaktiert.

```bash
./net-observe.sh live           # einmaliger Snapshot
./net-observe.sh watch          # Live-Ansicht, Ctrl-C
./net-observe.sh hosts 60       # 60 s Recon, unique Remote-Hosts + Reverse-DNS
sudo ./net-observe.sh pcap 60   # 60 s tcpdump → /tmp/kindle.pcap
```

Am nützlichsten ist `hosts 60`: gibt eine Liste der Amazon-Endpunkte, die Lassen tatsächlich anspricht. Dann wissen wir, worauf wir den MITM-Proxy zielen.

### `mitm-smoketest.md`

Schritt-für-Schritt-Anleitung zum mitmproxy-Setup. Fokus: **Zertifikats-Pinning-Status feststellen**, ohne Re-Login oder Neu-Install. Dauert ~30 min, reversibel.

## Interpretationsraster

| Befund | Bedeutung |
|---|---|
| fs_usage zeigt Writes von decrypted Chunks in /tmp | Lassen cached Plaintext-Content → wir müssen gar nicht MITM-en, nur Timing kennen |
| nettop hosts enthält verdächtige Endpunkte (z.B. `cde-ta-g7g.amazon.com`, `dcape-na.amazon.com`) | Kandidaten für MITM-Ziel |
| mitmproxy zeigt alle Verbindungen als TLS-Fehler | Pinning aktiv, Netzwerk-Route tot |
| mitmproxy zeigt manche Verbindungen OK | Selektives Pinning — vielleicht reicht uns der nicht-gepinnte Auth-Pfad |
| mitmproxy zeigt alles OK inklusive DRM-Endpunkte | Volltreffer — wir sehen ACCOUNT_SECRET im Klartext |

## Datenschutz / Cleanup

`mitm-smoketest.md` hat am Ende explizite Aufräum-Schritte. Ohne diese bleibt der mitmproxy-CA im System und der System-Proxy läuft ins Leere. **Unbedingt zurücksetzen**, bevor das Experiment beendet wird.
