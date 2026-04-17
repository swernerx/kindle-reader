# Kindle Extractor (Lassen, macOS)

Lokale Extraktion selbst gekaufter Kindle-Bücher aus der macOS-App `com.amazon.Lassen` nach Markdown und ePub. Eigennutzung.

## Status

**Phase**: 0 — Gerüst
**Ampel**: 🟢
**Live-Stand**: siehe [`docs/00-state.md`](docs/00-state.md)

## Roadmap

| Phase | Ziel | Paket |
|---|---|---|
| 0 | Monorepo-Gerüst, Doku | — |
| 1 | Metadaten-Katalog aller lokalen Bücher | `packages/catalog` |
| 2 | Keychain-Probe / Key-Extraktion (Decision-Gate) | `packages/keychain-probe` |
| 3 | DRMION-Entschlüsselung | `packages/drmion` |
| 4 | KFX/Amazon-Ion-Parser → strukturierter Text | `packages/kfx-parser` |
| 5 | Markdown- und ePub-Export | `packages/exporter` |

Der Plan steht in `/Users/sebastian/.claude/plans/ich-w-rde-gerne-eine-happy-mccarthy.md`. Agent-Rechercheberichte liegen als Anhang in `docs/10-filesystem.md`, `docs/11-drmion-format.md`, `docs/12-ui-ocr-fallback.md`.

## Dokumentationsdisziplin

- `docs/00-state.md` — Live-Status nach jedem Arbeitsblock aktualisiert.
- `docs/30-decisions.md` — jede Weggabelung als kurzer ADR.
- Phasenspezifische Notizen in `docs/NN-*.md`.

## Rechtliches

Eigennutzung auf Basis §53 UrhG, kein Sharing. Details in `docs/99-legal.md`.
