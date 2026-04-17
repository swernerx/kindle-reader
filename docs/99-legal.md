# Rechtliche Einordnung (DE) — Eigennutzung

> Keine Rechtsberatung. Die folgende Einschätzung reflektiert den aktuellen Forschungsstand und die Nutzerintention; im Zweifel Anwalt.

## Scope des Projekts

- **Ausschließlich eigene, legal bei Amazon gekaufte Kindle-Bücher.**
- **Kein Sharing** der entschlüsselten Dateien, extrahierter Schlüssel, Voucher-Inhalte oder abgeleiteter Binaries.
- **Eigene Inhaltsverarbeitung** (Zusammenfassungen, Volltextsuche, RAG für persönliche Recherche).

## Relevante Normen

- **§ 53 UrhG (Privatkopie)**: Erlaubt Kopien zum privaten Gebrauch, **nicht** jedoch bei Umgehung wirksamer technischer Schutzmaßnahmen.
- **§ 95a UrhG**: Verbot, wirksame technische Schutzmaßnahmen zu umgehen. Greift auch für Privatkopien.
- **§ 108b UrhG**: Strafbewehrung für gewerbliche Umgehung und für das Herstellen/Verbreiten von Umgehungstools. **Eigennutzung ohne Verbreitung ist in der Regel nicht strafbar**, im schlimmsten Fall Ordnungswidrigkeit.

## Pragmatische Konsequenzen für dieses Projekt

1. **Keine öffentlichen Forks, keine Releases.** Das Repository bleibt lokal bzw. privat.
2. **Keine Verbreitung** extrahierter Schlüssel, Voucher, entschlüsselter Payloads oder ePub-/Markdown-Ausgaben.
3. **Keine generische DeDRM-Werkzeugbau-Rhetorik** in Commit-Messages oder Doku — der Fokus bleibt "persönlicher Extraktor für eigene Bibliothek".
4. **Dokumentation** der Methoden ist zulässig (kein Herstellen eines Umgehungstools im Sinne von § 108b, solange das Wissen persönlich bleibt).

## Was dieses Projekt **nicht** tut

- Es wird nicht als paketiertes Tool an Dritte vertrieben.
- Es lädt keine Bücher herunter, die nicht bereits im Lassen-Container auf dem Gerät liegen.
- Es greift keine Amazon-Server an und umgeht keine Server-seitigen Schutzmaßnahmen.
- Die in diesem Repo dokumentierten Schlüssel, DSN, Device-IDs stammen ausschließlich von einem Gerät, das im Besitz des Nutzers ist, und werden nicht veröffentlicht.
